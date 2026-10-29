import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import {
  SessionStreamUpdateSchema,
  type MessageView,
  type SessionStreamUpdate,
} from '@my-pi-harness/protocol';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { Value } from 'typebox/value';
import { describe, expect, it, vi } from 'vitest';
import { loadDaemonConfig } from '../src/application/config.js';
import { createDaemonApplication, type DaemonApplication } from '../src/http/server.js';
import { createApplicationServices } from '../src/application/services.js';
import { loginFixture } from './support/login.js';

interface StreamRecord {
  event: string;
  id: string;
  update: SessionStreamUpdate;
  raw: string;
}

class RecordReader {
  private readonly decoder = new TextDecoder();
  private pending = '';
  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}
  async next(): Promise<StreamRecord> {
    while (true) {
      const end = this.pending.indexOf('\n\n');
      if (end >= 0) {
        const raw = this.pending.slice(0, end);
        this.pending = this.pending.slice(end + 2);
        const data = /^data: (.+)$/m.exec(raw)?.[1];
        if (!data) continue;
        const update: unknown = JSON.parse(data);
        if (!Value.Check(SessionStreamUpdateSchema, update))
          throw new Error('Invalid stream update');
        return {
          event: /^event: (.+)$/m.exec(raw)?.[1] ?? '',
          id: /^id: (.+)$/m.exec(raw)?.[1] ?? '',
          update,
          raw,
        };
      }
      const chunk = await this.reader.read();
      if (chunk.done) throw new Error('Stream closed before its next update');
      this.pending += this.decoder.decode(chunk.value, { stream: true });
    }
  }
  async close(): Promise<void> {
    await this.reader.cancel();
  }
}

const requireBody = (response: Response): RecordReader => {
  expect(response.status).toBe(200);
  if (!response.body) throw new Error('No SSE response body');
  return new RecordReader(response.body.getReader());
};

describe('private session projection SSE', () => {
  it('sends one baseline, bounded deltas, exact terminal state and fresh reconnect/branch baselines', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-stream-api-'));
    const readers: RecordReader[] = [];
    let application: DaemonApplication | undefined;
    try {
      const config = loadDaemonConfig({
        MY_PI_HARNESS_PORT: '0',
        MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
        MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
      });
      const services = await createApplicationServices(config, {
        credentials: createMemoryCredentialStore(),
      });
      const notifications = new EventEmitter();
      const subscribe = services.runtime.subscribe.bind(services.runtime);
      vi.spyOn(services.runtime, 'subscribe').mockImplementation((id, listener) => {
        const close = subscribe(id, listener);
        notifications.on(id, listener);
        return (): void => {
          notifications.off(id, listener);
          close();
        };
      });
      application = await createDaemonApplication(config, undefined, services);
      const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
      const grant = await loginFixture(origin, services);
      const session = services.runtime.createSession({
        title: 'Stream',
        providerId: 'fixture',
        modelId: 'model',
        thinkingLevel: 'off',
        workspaceId: null,
        approvalMode: 'ask',
      });
      const prefix = 'stable previous output '.repeat(10000);
      const message: MessageView = {
        id: 'streamed-message',
        sessionId: session.id,
        branchId: session.activeBranchId,
        runId: 'stream-run',
        role: 'assistant',
        text: prefix,
        thinking: '',
        createdAt: 2,
        status: 'streaming',
        stopReason: null,
      };
      const user: MessageView = {
        ...message,
        id: 'user-message',
        role: 'user',
        text: 'Request',
        status: 'complete',
      };
      services.runtime.record(session.id, [
        {
          type: 'run.accepted',
          runId: 'stream-run',
          at: 2,
          data: {
            requestId: 'stream-request',
            run: {
              id: 'stream-run',
              sessionId: session.id,
              branchId: session.activeBranchId,
              providerId: 'fixture',
              modelId: 'model',
              status: 'running',
              createdAt: 2,
              finishedAt: null,
              error: null,
            },
          },
        },
        { type: 'message.started', runId: 'stream-run', at: 2, data: user },
        {
          type: 'message.started',
          runId: 'stream-run',
          at: 2,
          data: message,
          privateData: { marker: 'private-host-metadata' },
        },
      ]);
      const url = `${origin}/api/sessions/${session.id}/events`;
      const reader = requireBody(
        await fetch(url, { headers: { Cookie: grant.cookie }, signal: AbortSignal.timeout(5000) }),
      );
      readers.push(reader);
      const initial = await reader.next();
      expect(initial.event).toBe('session.update');
      expect(initial.update).toEqual({
        kind: 'snapshot',
        snapshot: services.runtime.getSnapshot(session.id),
      });
      expect(initial.raw).not.toContain('session.event');
      expect(initial.raw).not.toContain('private-host-metadata');
      const baseSeq = services.runtime.getSnapshot(session.id).snapshotSeq;
      for (const fields of [{ text: 'new' }, { text: ' text' }, { thinking: 'reasoning' }]) {
        services.store.publishMessageDelta(session.id, {
          runId: 'stream-run',
          messageId: message.id,
          ...fields,
        });
        notifications.emit(session.id, {
          type: 'message.delta',
          sessionId: session.id,
          runId: 'stream-run',
        });
      }
      const delta = await reader.next();
      expect(delta.update).toMatchObject({
        kind: 'patch',
        baseSeq,
        baseLiveRevision: 0,
        snapshotSeq: baseSeq,
        liveRevision: 3,
        changes: [
          {
            type: 'message.append',
            id: message.id,
            textDelta: 'new text',
            thinkingDelta: 'reasoning',
          },
        ],
      });
      expect(delta.raw).not.toContain(prefix);
      expect(delta.raw.length).toBeLessThan(1600);
      expect(delta.id).toBe(`${baseSeq}:3`);
      const partialReconnect = requireBody(
        await fetch(url, {
          headers: { Cookie: grant.cookie, 'Last-Event-ID': initial.id },
          signal: AbortSignal.timeout(5000),
        }),
      );
      readers.push(partialReconnect);
      const partialBaseline = await partialReconnect.next();
      expect(partialBaseline.update).toMatchObject({
        kind: 'snapshot',
        snapshot: {
          snapshotSeq: baseSeq,
          liveRevision: 3,
          messages: [{}, { text: `${prefix}new text`, thinking: 'reasoning' }],
        },
      });
      await partialReconnect.close();
      readers.pop();
      const complete = {
        ...message,
        text: `${prefix}corrected final`,
        thinking: 'reasoning',
        status: 'complete' as const,
        stopReason: 'stop',
      };
      services.runtime.record(session.id, [
        { type: 'message.completed', runId: 'stream-run', at: 4, data: { message: complete } },
      ]);
      const terminal = await reader.next();
      expect(terminal.update).toMatchObject({
        kind: 'patch',
        baseSeq,
        baseLiveRevision: 3,
        snapshotSeq: baseSeq + 1,
        liveRevision: 0,
        changes: [{ type: 'message.set', index: 1, message: complete }],
      });
      services.runtime.record(session.id, [
        {
          type: 'run.finished',
          runId: 'stream-run',
          at: 4,
          data: { status: 'completed', finishedAt: 4, error: null },
        },
      ]);
      expect((await reader.next()).update).toMatchObject({
        kind: 'patch',
        changes: [{ type: 'run.set', run: { status: 'completed' } }],
      });
      const reconnected = requireBody(
        await fetch(url, {
          headers: { Cookie: grant.cookie, 'Last-Event-ID': initial.id },
          signal: AbortSignal.timeout(5000),
        }),
      );
      readers.push(reconnected);
      expect((await reconnected.next()).update).toEqual({
        kind: 'snapshot',
        snapshot: services.runtime.getSnapshot(session.id),
      });
      const branch = {
        id: 'revision',
        sessionId: session.id,
        parentId: session.activeBranchId,
        forkMessageId: user.id,
        createdAt: 5,
      };
      services.runtime.record(session.id, [
        { type: 'branch.created', runId: null, at: 5, data: branch },
      ]);
      await services.runtime.selectBranch(session.id, branch.id);
      const selected = await reader.next();
      expect(selected.update).toEqual({
        kind: 'snapshot',
        snapshot: services.runtime.getSnapshot(session.id),
      });
      expect(
        (
          await fetch(`${url}?afterSeq=0`, {
            headers: { Cookie: grant.cookie },
            signal: AbortSignal.timeout(5000),
          })
        ).status,
      ).toBe(400);
      expect((await fetch(url, { signal: AbortSignal.timeout(5000) })).status).toBe(401);
    } finally {
      for (const reader of readers) await reader.close();
      await application?.server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
