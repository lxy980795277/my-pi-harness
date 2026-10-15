import { mkdtemp, mkdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type AssistantMessage,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { type ApprovalMode } from '@my-pi-harness/protocol';
import { openProfileStore } from '@my-pi-harness/storage';
import { describe, expect, it } from 'vitest';
import { ModelApprovalReviewer } from '../src/approval-review.js';
import { SessionRuntime } from '../src/session-runtime.js';
import { ToolRuntime } from '../src/tool-runtime.js';
import type { EventInput } from '../src/runtime-ports.js';

function gate() {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Expected approval observation did not arrive');
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

function writeCall(): AssistantMessage {
  return fauxAssistantMessage(
    [
      {
        type: 'toolCall',
        id: 'write-call',
        name: 'write_file',
        arguments: { path: 'result.txt', content: 'approved output\n', expectedHash: null },
      },
    ],
    { stopReason: 'toolUse' },
  );
}

async function fixture(
  mode: ApprovalMode = 'auto',
  context?: () => unknown,
  reviewerOptions: Partial<
    Pick<ConstructorParameters<typeof ModelApprovalReviewer>[0], 'gateway' | 'timeoutMs'>
  > = {},
) {
  const temporary = await mkdtemp(join(tmpdir(), 'my-pi-approval-'));
  const directory = await realpath(temporary);
  const root = join(directory, 'workspace');
  await mkdir(root);
  const profile = join(directory, 'profile');
  const store = await openProfileStore(profile);
  const faux = fauxProvider({ tokensPerSecond: 0, tokenSize: { min: 64, max: 64 } });
  const models = createModels();
  models.setProvider(faux.provider);
  let releases = 0;
  let resolves = 0;
  const gateway = {
    resolve: () => {
      resolves += 1;
      return Promise.resolve({
        model: faux.models[0],
        streamFn: models.streamSimple.bind(models),
        release: () => {
          releases += 1;
        },
      });
    },
  };
  const reviewer = new ModelApprovalReviewer({
    gateway,
    context:
      context ??
      ((id) => ({
        userRequests: store
          .getSnapshot(id)
          .messages.filter((message) => message.role === 'user')
          .map(({ text }) => ({ text })),
      })),
    ...reviewerOptions,
  });
  const workspace = store.createWorkspace({
    id: 'workspace',
    name: 'Approval',
    icon: 'folder',
    rootPath: root,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  const errors: unknown[] = [];
  const tools = new ToolRuntime({
    profileDirectory: profile,
    resolveWorkspace: () => Promise.resolve(workspace),
    reviewer,
  });
  const runtime = new SessionRuntime({
    store,
    gateway,
    tools,
    onError: (error) => {
      errors.push(error);
    },
  });
  const session = runtime.createSession({
    title: 'Approval',
    providerId: faux.provider.id,
    modelId: faux.models[0].id,
    thinkingLevel: 'off',
    workspaceId: workspace.id,
    approvalMode: mode,
  });
  return {
    root,
    store,
    faux,
    reviewer,
    runtime,
    tools,
    session,
    errors,
    releases: () => releases,
    resolves: () => resolves,
    async send() {
      return await runtime.send(session.id, {
        text: 'Create result.txt with approved output.',
        mode: 'send',
        requestId: 'write',
      });
    },
    async idle() {
      await until(() => runtime.getSnapshot(session.id).session.activeRunId === null);
      await runtime.cancel(session.id);
    },
    async close() {
      await runtime.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe('isolated AI approval through real Pi tools and SQLite', () => {
  it('records and applies one AI allowance without adding reviewer messages or tools to the main agent', async () => {
    const f = await fixture();
    let reviewContext: TranscriptContext | undefined;
    try {
      f.faux.setResponses([
        writeCall(),
        (context) => {
          reviewContext = context;
          expect(
            context.messages.flatMap((message) =>
              message.role === 'system' ? (message.toolsAdded ?? []) : [],
            ),
          ).toEqual([]);
          expect(JSON.stringify(context.messages)).toContain('Create result.txt');
          return fauxAssistantMessage(
            JSON.stringify({ decision: 'allow', reason: '符合用户明确要求。' }),
          );
        },
        (context) => {
          expect(context.messages.filter((message) => message.role === 'user')).toHaveLength(1);
          expect(JSON.stringify(context.messages)).not.toContain('authorizationContext');
          return fauxAssistantMessage('Written');
        },
      ]);
      await f.send();
      await f.idle();
      expect(reviewContext).toBeDefined();
      expect(await readFile(join(f.root, 'result.txt'), 'utf8')).toBe('approved output\n');
      expect(f.runtime.getSnapshot(f.session.id).tools[0]).toMatchObject({
        status: 'completed',
        approval: { source: 'ai', decision: 'allow', reason: '符合用户明确要求。' },
      });
      const events = f.store.readEvents(f.session.id, 0, 1000);
      expect(events.some((event) => event.type === 'tool.review.requested')).toBe(true);
      expect(JSON.stringify(events)).not.toContain('systemPrompt');
      expect(
        events.filter((event) => event.type === 'tool.updated').map((event) => event.data['tool']),
      ).not.toContainEqual(expect.objectContaining({ status: 'awaiting_approval' }));
      expect(f.releases()).toBe(2);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('does not write a file when the reviewer denies the call', async () => {
    const f = await fixture();
    try {
      f.faux.setResponses([
        writeCall(),
        fauxAssistantMessage('{"decision":"deny","reason":"目标不符合请求。"}'),
        fauxAssistantMessage('Denied'),
      ]);
      await f.send();
      await f.idle();
      expect(f.runtime.getSnapshot(f.session.id).tools[0]).toMatchObject({
        status: 'denied',
        approval: { source: 'ai', decision: 'deny' },
      });
      await expect(stat(join(f.root, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await f.close();
    }
  });

  it.each(['invalid', 'ask'] as const)(
    'requires a human decision for a %s model verdict',
    async (kind) => {
      const f = await fixture();
      try {
        const response =
          kind === 'invalid'
            ? 'approve everything'
            : '{"decision":"ask","reason":"请用户确认范围。"}';
        f.faux.setResponses([
          writeCall(),
          fauxAssistantMessage(response),
          fauxAssistantMessage('Written after user approval'),
        ]);
        await f.send();
        await until(
          () => f.runtime.getSnapshot(f.session.id).tools[0]?.status === 'awaiting_approval',
        );
        await expect(stat(join(f.root, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
        const tool = f.runtime.getSnapshot(f.session.id).tools[0];
        if (!tool) throw new Error('Missing approval');
        expect(tool.approval).toMatchObject({ source: 'ai', decision: 'ask' });
        f.tools.decide(f.session.id, tool.id, { decision: 'allow' });
        await f.idle();
        expect(f.runtime.getSnapshot(f.session.id).tools[0]?.approval).toMatchObject({
          source: 'user',
          decision: 'allow',
        });
        expect(await readFile(join(f.root, 'result.txt'), 'utf8')).toBe('approved output\n');
      } finally {
        await f.close();
      }
    },
  );

  it('asks rather than dropping an oversized authorization context', async () => {
    const f = await fixture('auto', () => ({ userRequests: ['u'.repeat(1_000_000)] }));
    try {
      f.faux.setResponses([writeCall(), fauxAssistantMessage('User denied')]);
      await f.send();
      await until(
        () => f.runtime.getSnapshot(f.session.id).tools[0]?.status === 'awaiting_approval',
      );
      expect(
        f.store
          .readEvents(f.session.id, 0, 1000)
          .some((event) => event.type === 'tool.review.requested'),
      ).toBe(false);
      const tool = f.runtime.getSnapshot(f.session.id).tools[0];
      if (!tool) throw new Error('Missing approval');
      f.tools.decide(f.session.id, tool.id, { decision: 'deny' });
      await f.idle();
      await expect(stat(join(f.root, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(f.releases()).toBe(2);
    } finally {
      await f.close();
    }
  });

  it('requires human approval when the independent provider cannot resolve and keeps its error private', async () => {
    const failure = new Error('fake-private-provider-resolve-detail');
    let reviewResolves = 0;
    const f = await fixture('auto', undefined, {
      gateway: {
        resolve: () => {
          reviewResolves += 1;
          return Promise.reject(failure);
        },
      },
    });
    try {
      f.faux.setResponses([writeCall(), fauxAssistantMessage('No write after user denial')]);
      await f.send();
      await until(
        () => f.runtime.getSnapshot(f.session.id).tools[0]?.status === 'awaiting_approval',
      );
      const pending = f.runtime.getSnapshot(f.session.id).tools[0];
      if (!pending) throw new Error('Missing human approval after provider failure');
      expect(pending.approval).toMatchObject({ source: 'ai', decision: 'ask' });
      expect(reviewResolves).toBe(1);
      expect(f.resolves()).toBe(1);
      expect(f.releases()).toBe(0);
      await expect(stat(join(f.root, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(JSON.stringify(f.runtime.getSnapshot(f.session.id))).not.toContain(failure.message);
      expect(JSON.stringify(f.store.readEvents(f.session.id, 0, 1000))).not.toContain(
        failure.message,
      );
      f.tools.decide(f.session.id, pending.id, { decision: 'deny' });
      await f.idle();
      expect(f.runtime.getSnapshot(f.session.id).tools[0]).toMatchObject({
        status: 'denied',
        approval: { source: 'user', decision: 'deny' },
      });
      await expect(stat(join(f.root, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(f.releases()).toBe(1);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('waits for timed-out model work to settle and release its lease before asking the user', async () => {
    const f = await fixture('auto', undefined, { timeoutMs: 250 });
    const entered = gate();
    const aborted = gate();
    const settle = gate();
    let settled = false;
    try {
      f.faux.setResponses([
        writeCall(),
        async (_context, options) => {
          const signal = options?.signal;
          if (!signal) throw new Error('Missing review timeout signal');
          const observeAbort = (): void => aborted.release();
          signal.addEventListener('abort', observeAbort, { once: true });
          if (signal.aborted) observeAbort();
          entered.release();
          try {
            await aborted.promise;
            await settle.promise;
            throw new DOMException('fake-private-timeout-cleanup-detail', 'AbortError');
          } finally {
            signal.removeEventListener('abort', observeAbort);
            settled = true;
          }
        },
        fauxAssistantMessage('No write after user denial'),
      ]);
      await f.send();
      await entered.promise;
      await aborted.promise;
      expect(settled).toBe(false);
      expect(f.runtime.getSnapshot(f.session.id).tools[0]?.status).toBe('reviewing');
      expect(f.releases()).toBe(0);
      await expect(stat(join(f.root, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
      settle.release();
      await until(
        () => f.runtime.getSnapshot(f.session.id).tools[0]?.status === 'awaiting_approval',
      );
      const pending = f.runtime.getSnapshot(f.session.id).tools[0];
      if (!pending) throw new Error('Missing human approval after model timeout');
      expect(settled).toBe(true);
      expect(f.releases()).toBe(1);
      expect(pending.approval).toMatchObject({ source: 'ai', decision: 'ask' });
      expect(JSON.stringify(f.store.readEvents(f.session.id, 0, 1000))).not.toContain(
        'fake-private-timeout-cleanup-detail',
      );
      await expect(stat(join(f.root, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
      f.tools.decide(f.session.id, pending.id, { decision: 'deny' });
      await f.idle();
      expect(f.runtime.getSnapshot(f.session.id).tools[0]?.status).toBe('denied');
      await expect(stat(join(f.root, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(f.releases()).toBe(2);
      expect(f.errors).toEqual([]);
    } finally {
      settle.release();
      await f.close();
    }
  });

  it('stops an in-flight review before any side effect or manual approval', async () => {
    const f = await fixture();
    const entered = gate();
    let aborted = false;
    try {
      f.faux.setResponses([
        writeCall(),
        async (_context, options) => {
          const signal = options?.signal;
          if (!signal) throw new Error('Missing review signal');
          const waiting = new Promise<never>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(new DOMException('Stopped', 'AbortError'));
              },
              { once: true },
            );
          });
          entered.release();
          return await waiting;
        },
      ]);
      await f.send();
      await entered.promise;
      expect(f.runtime.getSnapshot(f.session.id).tools[0]?.status).toBe('reviewing');
      await f.runtime.cancel(f.session.id);
      expect(aborted).toBe(true);
      expect(f.runtime.getSnapshot(f.session.id).tools[0]?.status).toBe('cancelled');
      expect(f.releases()).toBe(2);
      await expect(stat(join(f.root, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await f.close();
    }
  });

  it('does not retry an unknown review tool call or accept a later allowance', async () => {
    const f = await fixture();
    let requests = 0;
    const audit: EventInput[] = [];
    try {
      f.faux.setResponses([
        () => {
          requests += 1;
          return writeCall();
        },
        () => {
          requests += 1;
          return fauxAssistantMessage('{"decision":"allow","reason":"must not be used"}');
        },
      ]);
      const verdict = await f.reviewer.review(
        {
          session: f.session,
          runId: 'single-review',
          tool: { id: 'tool', name: 'write_file', arguments: {}, summary: 'Write' },
          commit: (events) => {
            audit.push(...events);
          },
        },
        new AbortController().signal,
      );
      expect(verdict.decision).toBe('ask');
      expect(requests).toBe(1);
      expect(audit.map((event) => event.type)).toEqual([
        'tool.review.requested',
        'tool.review.completed',
      ]);
      expect(f.releases()).toBe(1);
      await expect(stat(join(f.root, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await f.close();
    }
  });

  it('does not downgrade a durable audit failure to human approval', async () => {
    const f = await fixture();
    const failure = new Error('Synthetic audit transaction failure');
    let commits = 0;
    try {
      await expect(
        f.reviewer.review(
          {
            session: f.session,
            runId: 'review-only',
            tool: { id: 'tool', name: 'write_file', arguments: {}, summary: 'Write' },
            commit: () => {
              commits += 1;
              throw failure;
            },
          },
          new AbortController().signal,
        ),
      ).rejects.toBe(failure);
      expect(commits).toBe(1);
      expect(f.releases()).toBe(1);
    } finally {
      await f.close();
    }
  });

  it('records full-access approval without calling the independent reviewer', async () => {
    const f = await fixture('full-access');
    try {
      f.faux.setResponses([writeCall(), fauxAssistantMessage('Written')]);
      await f.send();
      await f.idle();
      expect(await readFile(join(f.root, 'result.txt'), 'utf8')).toBe('approved output\n');
      expect(f.runtime.getSnapshot(f.session.id).tools[0]?.approval).toEqual({
        source: 'full-access',
        decision: 'allow',
        reason: null,
      });
      expect(f.resolves()).toBe(1);
      expect(
        f.store
          .readEvents(f.session.id, 0, 1000)
          .some((event) => event.type === 'tool.review.requested'),
      ).toBe(false);
    } finally {
      await f.close();
    }
  });
});
