import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import type { ApprovalMode, SessionSummary, ToolCallView } from '@my-pi-harness/protocol';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { expect, it } from 'vitest';
import { startTestModel } from '../../../tests/e2e/model-server';
import { memoryMutationReply, type MemoryToolStep } from '../../../tests/e2e/memory-model';
import { loadDaemonConfig } from '../src/application/config';
import { createApplicationServices } from '../src/application/services';
import { createDaemonApplication } from '../src/http/server';
import { loginFixture } from './support/login';

it('saves and learns inside real Pi loops, rechecks settings and uses ordinary deletion approval', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-memory-writes-api-'));
  let command: MemoryToolStep | undefined;
  const runtimeErrors: unknown[] = [];
  const model = await startTestModel({
    reply: memoryMutationReply(() => (command ? [command] : [])),
  });
  let closeServices: (() => Promise<void>) | undefined;
  let closeApplication: (() => Promise<void>) | undefined;
  try {
    const config = loadDaemonConfig({
      MY_PI_HARNESS_PORT: '0',
      MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
      MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
    });
    const services = await createApplicationServices(config, {
      credentials: createMemoryCredentialStore(),
      onError: (error) => runtimeErrors.push(error),
    });
    closeServices = () => services.close();
    const application = await createDaemonApplication(config, undefined, services);
    closeApplication = () => application.server.close();
    const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
    expect((await fetch(`${origin}/api/memories`)).status).toBe(401);
    const grant = await loginFixture(origin, services);
    const headers = {
      Cookie: grant.cookie,
      Origin: origin,
      'X-CSRF-Token': grant.csrf,
      'Content-Type': 'application/json',
    };
    const send = async (path: string, method = 'GET', body?: unknown) =>
      await fetch(`${origin}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
    const provider = await services.gateway.saveProvider({
      name: 'Synthetic memory provider',
      kind: 'custom',
      builtinId: null,
      api: 'openai-completions',
      baseUrl: `${model.origin}/v1`,
      enabled: true,
      requiresApiKey: true,
      models: [
        {
          id: 'memory-model',
          name: 'Memory',
          api: 'openai-completions',
          contextWindow: 32768,
          maxTokens: 1024,
          reasoning: false,
          input: ['text'],
        },
      ],
    });
    await services.gateway.setApiKey(provider.id, 'synthetic-account-key');
    const createSession = (approvalMode: ApprovalMode = 'ask') =>
      services.runtime.createSession({
        providerId: provider.id,
        modelId: 'memory-model',
        thinkingLevel: 'off',
        workspaceId: null,
        approvalMode,
        title: 'Direct memory test',
      });
    const idle = async (session: SessionSummary) => {
      const signal = AbortSignal.timeout(12000);
      for (;;) {
        const snapshot = services.runtime.getSnapshot(session.id);
        if (snapshot.session.activeRunId === null) return snapshot;
        signal.throwIfAborted();
        await wait(20, undefined, { signal });
      }
    };
    let request = 0;
    const input = async (session: SessionSummary, text: string) => {
      request += 1;
      expect(
        (
          await send(`/api/sessions/${session.id}/inputs`, 'POST', {
            text,
            requestId: `direct-${request}`,
            mode: 'send',
          })
        ).status,
      ).toBe(200);
    };
    const operate = async (session: SessionSummary, text: string, next: MemoryToolStep) => {
      command = next;
      await input(session, text);
      const snapshot = await idle(session);
      expect(
        snapshot.runs.at(-1)?.status,
        JSON.stringify({
          error: snapshot.runs.at(-1)?.error,
          errors: runtimeErrors.map((error) => String(error)),
          tools: snapshot.tools.map((tool) => ({
            name: tool.name,
            status: tool.status,
            result: tool.result,
          })),
          requests: model.requests.length,
        }),
      ).toBe('completed');
      const tool = snapshot.tools.at(-1);
      if (!tool) throw new Error('Expected real tool execution');
      expect(tool.name).toBe(next.name);
      return tool;
    };
    const settings = async (allowUse: boolean, allowLearning: boolean) => {
      const current = services.memory.settings();
      const response = await send('/api/memory-settings', 'PUT', {
        requestId: `settings-${current.revision}`,
        expectedRevision: current.revision,
        allowUse,
        allowLearning,
      });
      expect(response.status).toBe(200);
    };
    expect(services.memory.settings()).toEqual({
      allowUse: true,
      allowLearning: true,
      revision: 0,
    });
    expect((await send('/api/memory-proposals')).status).toBe(404);
    expect((await send('/api/memory-proposals/missing/confirm', 'POST', {})).status).toBe(404);
    const session = createSession();
    expect(
      (
        await send(`/api/sessions/${session.id}/inputs`, 'POST', {
          text: '旧学习动作已经移除。',
          requestId: 'obsolete',
          mode: 'send',
          memoryLearning: {},
        })
      ).status,
    ).toBe(400);
    const body = '回答先给简洁中文结论，再提供必要依据。';
    const learned = await operate(session, '我一直喜欢先看到简洁中文结论。', {
      name: 'learn_memory',
      arguments: { scope: 'user', category: 'preference', body },
    });
    expect(learned).toMatchObject({ status: 'completed' });
    expect(learned.approval).toBeUndefined();
    expect(JSON.stringify(model.requests.at(-1)?.body['messages'])).toContain(
      'use=on; learning=on.',
    );
    const entry = services.memory.list().items[0];
    if (!entry) throw new Error('Learning did not save a fact');
    expect(entry).toMatchObject({ body, mode: 'fixed', source: { kind: 'message' } });
    const declarations: unknown = model.requests[0]?.body['tools'];
    expect(JSON.stringify(declarations)).toContain('save_memory');
    expect(JSON.stringify(declarations)).toContain('learn_memory');
    expect(JSON.stringify(declarations)).not.toContain('propose_memory');

    command = undefined;
    const fresh = createSession();
    await input(fresh, '解释一下HTTP缓存。');
    await idle(fresh);
    expect(JSON.stringify(model.requests.at(-1)?.body['messages']).split(body)).toHaveLength(2);

    await settings(true, false);
    const blocked = await operate(session, '我通常喜欢一段补充说明。', {
      name: 'learn_memory',
      arguments: { scope: 'user', category: 'preference', body: '先写短说明。' },
    });
    expect(blocked.status).toBe('failed');
    expect(JSON.stringify(model.requests.at(-1)?.body['messages'])).toContain(
      'use=on; learning=off.',
    );
    expect(services.memory.list().total).toBe(1);
    const explicit = await operate(session, '请记住：所有示例使用TypeScript。', {
      name: 'save_memory',
      arguments: { scope: 'user', category: 'instruction', body: '所有示例使用TypeScript。' },
    });
    expect(explicit.status).toBe('completed');
    expect(explicit.approval).toBeUndefined();
    const revisedBody = '回答先给中文结论，随后用短列表说明。';
    const updated = await operate(session, '把刚才的回答偏好改成结论后用短列表。', {
      name: 'update_memory',
      arguments: {
        memoryId: entry.id,
        expectedRevision: entry.revision,
        category: 'preference',
        body: revisedBody,
      },
    });
    expect(updated.status).toBe('completed');
    const conflict = await operate(session, '修改时必须保护新版本。', {
      name: 'update_memory',
      arguments: {
        memoryId: entry.id,
        expectedRevision: entry.revision,
        category: 'preference',
        body: '不能覆盖已有修改。',
      },
    });
    expect(conflict.status).toBe('failed');
    expect(services.memory.list().items.find((value) => value.id === entry.id)?.body).toBe(
      revisedBody,
    );

    await settings(false, true);
    expect(
      (
        await operate(session, '关闭使用时也不要自动学习。', {
          name: 'learn_memory',
          arguments: { scope: 'user', category: 'fact', body: '这个事实不得写入。' },
        })
      ).status,
    ).toBe('failed');
    expect(JSON.stringify(model.requests.at(-1)?.body['messages'])).toContain(
      'use=off; learning=on.',
    );
    await settings(true, true);
    command = { name: 'delete_memory', arguments: { memoryId: entry.id, expectedRevision: 2 } };
    await input(session, '忘记刚才的回答偏好。');
    const signal = AbortSignal.timeout(12000);
    let pending: ToolCallView | undefined;
    while (!pending) {
      pending = services.runtime
        .getSnapshot(session.id)
        .tools.find((tool) => tool.name === 'delete_memory' && tool.status === 'awaiting_approval');
      signal.throwIfAborted();
      if (!pending) await wait(20, undefined, { signal });
    }
    expect(services.memory.list().items.some((value) => value.id === entry.id)).toBe(true);
    expect(
      (
        await send(`/api/sessions/${session.id}/tools/${pending.id}/decision`, 'POST', {
          decision: 'allow',
        })
      ).status,
    ).toBe(200);
    expect((await idle(session)).tools.at(-1)).toMatchObject({ status: 'completed' });
    expect(services.memory.list().items.some((value) => value.id === entry.id)).toBe(false);
    const remaining = services.memory.list().items[0];
    if (!remaining) throw new Error('Missing second saved memory');
    expect(
      await operate(createSession('full-access'), '忘记TypeScript示例约定。', {
        name: 'delete_memory',
        arguments: { memoryId: remaining.id, expectedRevision: remaining.revision },
      }),
    ).toMatchObject({
      status: 'completed',
      approval: { source: 'full-access', decision: 'allow' },
    });
    expect(services.memory.list().total).toBe(0);
  } finally {
    const failures: unknown[] = [];
    for (const dispose of [
      () => (closeApplication === undefined ? closeServices?.() : closeApplication()),
      () => model.close(),
      () => rm(directory, { recursive: true, force: true }),
    ]) {
      try {
        await dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Memory fixture teardown failed');
  }
}, 30000);
