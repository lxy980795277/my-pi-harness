import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MessageView } from '@my-pi-harness/protocol';
import {
  createMemoryCredentialStore,
  sessionLogDirectory,
  SessionBatchSchema,
} from '@my-pi-harness/storage';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { loadDaemonConfig } from '../src/application/config.js';
import { createDaemonApplication, type DaemonApplication } from '../src/http/server.js';
import { createApplicationServices } from '../src/application/services.js';
import { loginFixture, pairFixture } from './support/login.js';

describe('authenticated original session JSONL download', () => {
  it('downloads original batches across branches and rejects untrusted, logged-out and invalid requests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-session-download-'));
    let application: DaemonApplication | undefined;
    try {
      const config = loadDaemonConfig({
        MY_PI_HARNESS_PORT: '0',
        MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
        MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
        MY_PI_HARNESS_GITHUB_CLIENT_ID: 'synthetic-github-client-id',
        MY_PI_HARNESS_GITHUB_CLIENT_SECRET: 'synthetic-github-client-secret',
      });
      const credentials = createMemoryCredentialStore();
      await credentials.write('fixture-model', 'synthetic-provider-api-key');
      const services = await createApplicationServices(config, { credentials });
      application = await createDaemonApplication(config, undefined, services);
      const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
      const grant = await loginFixture(origin, services);
      const session = services.runtime.createSession({
        title: 'Download 日志',
        providerId: 'fixture',
        modelId: 'model',
        thinkingLevel: 'off',
        workspaceId: null,
        approvalMode: 'ask',
      });
      const user: MessageView = {
        id: 'question',
        sessionId: session.id,
        branchId: session.activeBranchId,
        runId: null,
        role: 'user',
        text: 'Question',
        thinking: '',
        createdAt: 2,
        status: 'complete',
        stopReason: null,
      };
      const original: MessageView = {
        ...user,
        id: 'original',
        role: 'assistant',
        text: 'Original answer',
      };
      const hostMetadata = {
        marker: 'private-assistant-codec',
        content: [{ type: 'text', text: 'private-native\n"content"' }],
        attributes: { enabled: true, count: 2 },
      };
      services.runtime.record(session.id, [
        { type: 'message.started', runId: null, at: 2, data: user },
        {
          type: 'message.started',
          runId: null,
          at: 2,
          data: original,
          privateData: hostMetadata,
        },
        {
          type: 'branch.created',
          runId: null,
          at: 3,
          data: {
            id: 'revision',
            sessionId: session.id,
            parentId: session.activeBranchId,
            forkMessageId: user.id,
            createdAt: 3,
          },
        },
      ]);
      await services.runtime.selectBranch(session.id, 'revision');
      services.runtime.record(session.id, [
        {
          type: 'message.started',
          runId: null,
          at: 4,
          data: { ...original, id: 'revised', branchId: 'revision', text: 'Revised answer' },
        },
      ]);
      expect(services.runtime.getSnapshot(session.id).messages.map(({ id }) => id)).toEqual([
        'revised',
      ]);
      const path = join(
        sessionLogDirectory(await realpath(config.profileDirectory), config.sessionLogRoot),
        `${session.id}.jsonl`,
      );
      const persisted = await readFile(path, 'utf8');
      const url = `${origin}/api/sessions/${session.id}/log`;
      const headers = { Cookie: grant.cookie };
      const request = (address: string, requestHeaders: Record<string, string> = headers) =>
        fetch(address, { headers: requestHeaders, signal: AbortSignal.timeout(5000) });
      const response = await request(url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="${session.id}.jsonl"`,
      );
      expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(persisted)));
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      const text = await response.text();
      expect(text).toBe(persisted);
      const batches = text
        .trimEnd()
        .split('\n')
        .map((line) => {
          const batch: unknown = JSON.parse(line);
          if (!Value.Check(SessionBatchSchema, batch)) throw new Error('Invalid downloaded batch');
          expect(Object.keys(batch).sort()).toEqual(['checksum', 'records', 'version']);
          expect(batch.version).toBe(3);
          return batch;
        });
      const privateRecord = batches
        .flatMap(({ records }) => records)
        .find(({ event }) => {
          return event.type === 'message.started' && event.data.id === original.id;
        });
      expect(privateRecord?.privateData).toEqual(hostMetadata);
      expect(text).toContain('Original answer');
      expect(text).toContain('Revised answer');
      expect(text).toContain('private-assistant-codec');
      expect(text).not.toContain('synthetic-provider-api-key');
      expect(text).not.toContain('synthetic-github-client-secret');
      expect(text).not.toContain('my_pi_session=');
      expect((await request(url, {})).status).toBe(401);
      const paired = await pairFixture(origin, services.auth.pairingCode);
      const loggedOut = await request(url, { Cookie: paired.cookie });
      expect(loggedOut.status).toBe(401);
      expect(await loggedOut.json()).toMatchObject({ code: 'LOGIN_REQUIRED' });
      const foreign = await request(url, { ...headers, Origin: 'https://untrusted.example' });
      expect(foreign.status).toBe(403);
      expect((await request(`${url}?path=outside`)).status).toBe(400);
      expect((await request(`${origin}/api/sessions/bad%22id/log`)).status).toBe(400);
      expect((await request(`${origin}/api/sessions/%2E%2E%2Foutside/log`)).status).toBe(400);
      const missing = await request(`${origin}/api/sessions/missing/log`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({ code: 'SESSION_NOT_FOUND' });
      await services.runtime.deleteSession(session.id);
      expect((await request(url)).status).toBe(404);
    } finally {
      await application?.server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
