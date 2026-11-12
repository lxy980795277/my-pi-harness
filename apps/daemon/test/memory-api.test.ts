import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import {
  MemoryMutationResultSchema,
  MemorySettingsSchema,
  type MemoryCreateInput,
} from '@my-pi-harness/protocol';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { Value } from 'typebox/value';
import { expect, it } from 'vitest';
import { loadDaemonConfig } from '../src/application/config';
import { createApplicationServices } from '../src/application/services';
import { createDaemonApplication } from '../src/http/server';
import { loginFixture } from './support/login';

it('protects memory facts, checks scope/revisions and never resurrects forgotten writes after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-memory-api-'));
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
  });
  const services = await createApplicationServices(config, {
    credentials: createMemoryCredentialStore(),
  });
  const application = await createDaemonApplication(config, undefined, services);
  try {
    const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
    expect((await fetch(`${origin}/api/memories`)).status).toBe(401);
    const grant = await loginFixture(origin, services);
    const headers = {
      Cookie: grant.cookie,
      Origin: origin,
      'X-CSRF-Token': grant.csrf,
      'Content-Type': 'application/json',
    };
    const send = async (path: string, method: string, body?: unknown) =>
      await fetch(`${origin}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const settingsResponse = await send('/api/memory-settings', 'GET');
    const settings: unknown = await settingsResponse.json();
    expect(Value.Check(MemorySettingsSchema, settings)).toBe(true);
    expect(settings).toMatchObject({ allowUse: true, allowLearning: true, revision: 0 });
    const input: MemoryCreateInput = {
      requestId: 'manual-1',
      scope: { kind: 'user' },
      category: 'preference',
      body: '回答使用简洁中文。',
      enabled: true,
    };
    expect((await send('/api/memories', 'POST', { ...input, ownerUserId: 'another' })).status).toBe(
      400,
    );
    expect(
      (
        await send('/api/memories', 'POST', {
          ...input,
          scope: { kind: 'workspace', workspaceId: 'missing' },
        })
      ).status,
    ).toBe(404);
    expect((await send('/api/memories?scope=user&workspaceId=wrong', 'GET')).status).toBe(422);
    const response = await send('/api/memories', 'POST', input);
    expect(response.status).toBe(200);
    const created: unknown = await response.json();
    if (!Value.Check(MemoryMutationResultSchema, created) || created.entry === null)
      throw new Error('Expected confirmed memory');
    const entry = created.entry;
    expect(await (await send('/api/memories', 'POST', input)).json()).toEqual(created);
    const update = {
      requestId: 'edit-1',
      expectedRevision: entry.revision,
      body: '回答使用中文，先给结论。',
      category: entry.category,
      mode: 'relevant',
      enabled: true,
    };
    const updated = await send(`/api/memories/${entry.id}`, 'PATCH', update);
    expect(updated.status).toBe(200);
    expect(
      (await send(`/api/memories/${entry.id}`, 'PATCH', { ...update, requestId: 'conflict-1' }))
        .status,
    ).toBe(409);
    expect(
      await (await send('/api/memories?scope=user&mode=relevant&limit=1', 'GET')).json(),
    ).toMatchObject({
      items: [{ id: entry.id, mode: 'relevant', revision: 2 }],
      total: 1,
      nextCursor: null,
    });
    expect(await (await send('/api/memories?mode=fixed', 'GET')).json()).toMatchObject({
      items: [],
      total: 0,
    });
    expect((await send('/api/memories?limit=101', 'GET')).status).toBe(400);
    expect(
      await (await send('/api/memories/statuses', 'POST', { ids: [entry.id, 'missing'] })).json(),
    ).toEqual([
      { id: entry.id, revision: 2, enabled: true, mode: 'relevant' },
      { id: 'missing', revision: null, enabled: false, mode: null },
    ]);
    services.store.createSession({
      id: 'memory-session',
      branchId: 'memory-branch',
      title: 'Memory request',
      providerId: 'fixture',
      modelId: 'fixture',
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'full-access',
      at: Date.now(),
    });
    const identity = {
      sessionId: 'memory-session',
      workspaceId: null,
      query: update.body,
      signal: AbortSignal.timeout(10000),
    };
    for (;;) {
      identity.signal.throwIfAborted();
      const index = services.search.indexStatus();
      if (index.state === 'ready' && index.pendingSources === 0 && index.sourceCount === 1) break;
      await wait(25, undefined, { signal: identity.signal });
    }
    const adopted = await services.memory.readSnapshot(identity);
    expect(adopted.entries).toEqual([]);
    expect(adopted.selection).toMatchObject({
      verification: 'unavailable',
      matchedCount: 0,
      omissions: [{ id: entry.id, reason: 'unverified' }],
    });
    expect(await services.memory.searchMemories(identity, update.body, 5)).toMatchObject({
      entries: [{ id: entry.id }],
    });
    expect(
      (
        await send(`/api/memories/${entry.id}`, 'DELETE', {
          requestId: 'forget-1',
          expectedRevision: 2,
        })
      ).status,
    ).toBe(200);
    expect(services.memory.isCurrent(identity, adopted.fingerprint)).toBe(false);
    expect((await services.memory.readSnapshot(identity)).entries).toEqual([]);
    expect(await (await send('/api/memories?scope=user', 'GET')).json()).toMatchObject({
      items: [],
      nextCursor: null,
      total: 0,
    });
    expect(await (await send('/api/memories', 'POST', input)).json()).toMatchObject({
      entry: null,
    });
    expect(
      (
        await send('/api/memory-settings', 'PUT', {
          requestId: 'settings-1',
          expectedRevision: 0,
          allowUse: false,
          allowLearning: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send('/api/memory-settings', 'PUT', {
          requestId: 'settings-conflict',
          expectedRevision: 0,
          allowUse: true,
          allowLearning: true,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send('/api/memories', 'POST', {
          ...input,
          requestId: 'bad-source',
          source: {
            kind: 'message',
            sessionId: 'missing',
            branchId: 'missing',
            messageId: 'missing',
            contentHash: '0'.repeat(64),
          },
        })
      ).status,
    ).toBe(409);
    await application.server.close();
    const reopened = await createApplicationServices(config, {
      credentials: createMemoryCredentialStore(),
    });
    try {
      expect(reopened.memory.list()).toMatchObject({ items: [], nextCursor: null, total: 0 });
      expect(reopened.memory.settings()).toMatchObject({ allowUse: false, revision: 1 });
      expect(await reopened.memory.create(input)).toMatchObject({ entry: null });
    } finally {
      await reopened.close();
    }
  } finally {
    await application.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
