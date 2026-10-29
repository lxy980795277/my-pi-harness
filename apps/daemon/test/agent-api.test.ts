import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentBoardSchema,
  AgentSettingsSchema,
  AgentTaskListSchema,
} from '@my-pi-harness/protocol';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { Value } from 'typebox/value';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDaemonConfig } from '../src/application/config.js';
import { createApplicationServices } from '../src/application/services.js';
import { createDaemonApplication, type DaemonApplication } from '../src/http/server.js';
import { loginFixture } from './support/login.js';

const fixtures: { directory: string; application: DaemonApplication }[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-agents-api-'));
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
  });
  const services = await createApplicationServices(config, {
    credentials: createMemoryCredentialStore(),
  });
  let application: DaemonApplication | undefined;
  try {
    application = await createDaemonApplication(config, undefined, services);
    const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
    const grant = await loginFixture(origin, services);
    const headers = {
      Origin: origin,
      Cookie: grant.cookie,
      'X-CSRF-Token': grant.csrf,
      'Content-Type': 'application/json',
    };
    services.store.createSession({
      id: 'first',
      branchId: 'main',
      title: 'First',
      providerId: 'fixture',
      modelId: 'model',
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'ask',
      at: 1,
    });
    fixtures.push({ directory, application });
    const send = (path: string, method = 'GET', body?: unknown): Promise<Response> => {
      return fetch(`${origin}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(5000),
      });
    };
    return { services, origin, headers, send };
  } catch (error) {
    if (application !== undefined) await application.server.close();
    else await services.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

afterEach(async () => {
  for (const value of fixtures.splice(0)) {
    try {
      await value.application.server.close();
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  }
});

describe('protected task HTTP APIs', () => {
  it('parses bounded numeric URL parameters explicitly with global coercion disabled', async () => {
    const f = await fixture();
    const response = await f.send('/api/agents?cursor=0&limit=1&filter=pending');
    expect(response.status).toBe(200);
    const board: unknown = await response.json();
    expect(Value.Check(AgentBoardSchema, board)).toBe(true);
    expect(board).toEqual({ tasks: [], nextCursor: null });
    const tasks = await f.send('/api/sessions/first/agents');
    expect(tasks.status).toBe(200);
    const list: unknown = await tasks.json();
    expect(Value.Check(AgentTaskListSchema, list)).toBe(true);
    for (const query of [
      'limit=201',
      'limit=0',
      'cursor=-1',
      'cursor=NaN',
      'cursor=1.5',
      'other=1',
      'limit=1&limit=2',
    ]) {
      expect((await f.send(`/api/agents?${query}`)).status).toBe(400);
    }
    const missing = await f.send('/api/sessions/first/agents/missing?cursor=0&limit=1');
    expect(missing.status).toBe(404);
  });

  it('saves role settings only at the edited revision and preserves a later saved configuration', async () => {
    const f = await fixture();
    const current: unknown = await (await f.send('/api/agent-settings')).json();
    if (!Value.Check(AgentSettingsSchema, current)) throw new Error('Invalid settings fixture');
    const changed = { ...current, limits: { ...current.limits, maxConcurrentRequests: 2 } };
    const saved = await f.send('/api/agent-settings', 'PUT', changed);
    expect(saved.status).toBe(200);
    const updated: unknown = await saved.json();
    expect(updated).toMatchObject({
      revision: current.revision + 1,
      limits: { maxConcurrentRequests: 2 },
    });
    const stale = await f.send('/api/agent-settings', 'PUT', current);
    expect(stale.status).toBe(409);
    expect(await (await f.send('/api/agent-settings')).json()).toEqual(updated);
    expect(
      (await f.send('/api/agent-settings', 'PUT', { ...changed, unexpected: true })).status,
    ).toBe(400);
    if (!Value.Check(AgentSettingsSchema, updated)) throw new Error('Invalid saved settings');
    const role = updated.roles[0];
    if (role === undefined) throw new Error('Missing role fixture');
    for (const roles of [
      [role, role],
      [{ ...role, providerId: 'unpaired-provider', modelId: null }],
    ]) {
      const invalid = await f.send('/api/agent-settings', 'PUT', { ...updated, roles });
      expect(invalid.status).toBe(422);
      expect(await invalid.json()).toMatchObject({ code: 'AGENT_SETTINGS_INVALID' });
    }
    expect(await (await f.send('/api/agent-settings')).json()).toEqual(updated);
  });

  it('keeps task reads private and rejects missing stop expectations before execution lookup', async () => {
    const f = await fixture();
    const unauthorized = await fetch(`${f.origin}/api/agents`, {
      headers: { Origin: f.origin },
      signal: AbortSignal.timeout(5000),
    });
    expect(unauthorized.status).toBe(401);
    await unauthorized.body?.cancel();
    expect((await f.send('/api/sessions/first/agents/missing/stop', 'POST', {})).status).toBe(400);
    expect(
      (
        await f.send('/api/sessions/first/agents/missing/messages', 'POST', {
          requestId: 'request',
          text: 'more',
          continue: true,
        })
      ).status,
    ).toBe(400);
  });
});
