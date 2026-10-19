import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionSnapshotSchema, WorkspaceSchema } from '@my-pi-harness/protocol';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { loadDaemonConfig } from '../src/config.js';
import { createDaemonApplication } from '../src/server.js';
import { createApplicationServices } from '../src/services.js';
import { loginFixture } from './support/login.js';

describe('protected workspace API', () => {
  it('validates directories and optimistic names, fixes session workspace ownership and archives metadata only', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-workspace-api-'));
    const profile = join(directory, 'profile');
    const project = join(directory, 'project');
    await mkdir(project);
    await writeFile(join(project, 'keep.txt'), 'User data');
    const config = loadDaemonConfig({
      MY_PI_HARNESS_PORT: '0',
      MY_PI_HARNESS_PROFILE_DIRECTORY: profile,
      MY_PI_HARNESS_SESSION_LOG_ROOT: join(profile, '.my-pi-harness'),
    });
    const services = await createApplicationServices(config, {
      credentials: createMemoryCredentialStore(),
    });
    const application = await createDaemonApplication(config, undefined, services);
    try {
      const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
      expect((await fetch(`${origin}/api/workspaces`)).status).toBe(401);
      const grant = await loginFixture(origin, services);
      const headers = {
        Cookie: grant.cookie,
        Origin: origin,
        'X-CSRF-Token': grant.csrf,
        'Content-Type': 'application/json',
      };
      const send = (path: string, method: string, body?: unknown): Promise<Response> =>
        fetch(`${origin}${path}`, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      expect(
        (await send('/api/workspaces', 'POST', { rootPath: project, arbitrary: true })).status,
      ).toBe(400);
      expect(
        (await send('/api/workspaces', 'POST', { rootPath: project, icon: 'unknown' })).status,
      ).toBe(400);
      expect((await send('/api/workspaces', 'POST', { rootPath: profile })).status).toBe(422);
      const sensitiveRoot = join(project, '.env-private');
      await mkdir(sensitiveRoot);
      const rejectedRoot = await send('/api/workspaces', 'POST', { rootPath: sensitiveRoot });
      expect(rejectedRoot.status).toBe(422);
      expect(await rejectedRoot.json()).toMatchObject({ code: 'WORKSPACE_PATH_PROTECTED' });
      const longRoot = join(project, 'x'.repeat(160));
      await mkdir(longRoot);
      const longResponse = await send('/api/workspaces', 'POST', { rootPath: longRoot });
      expect(longResponse.status).toBe(200);
      const longWorkspace: unknown = await longResponse.json();
      if (!Value.Check(WorkspaceSchema, longWorkspace))
        throw new Error('Invalid long workspace response');
      expect(longWorkspace.icon).toBe('folder');
      expect(longWorkspace.name).toBe('x'.repeat(120));
      expect(longWorkspace.rootPath.endsWith('x'.repeat(160))).toBe(true);
      expect((await send(`/api/workspaces/${longWorkspace.id}`, 'DELETE', {})).status).toBe(200);
      expect(
        (await send('/api/workspaces', 'POST', { rootPath: longRoot, name: 'x'.repeat(121) }))
          .status,
      ).toBe(400);
      const created = await send('/api/workspaces', 'POST', {
        rootPath: project,
        icon: 'briefcase',
      });
      expect(created.status).toBe(200);
      const workspace: unknown = await created.json();
      if (!Value.Check(WorkspaceSchema, workspace)) throw new Error('Invalid workspace response');
      expect(workspace.icon).toBe('briefcase');
      expect((await send('/api/workspaces', 'POST', { rootPath: project })).status).toBe(409);
      expect(
        (
          await send(`/api/workspaces/${workspace.id}`, 'PUT', {
            name: 'Rejected',
            icon: 'unknown',
            expectedRevision: 1,
          })
        ).status,
      ).toBe(400);
      const renamed = await send(`/api/workspaces/${workspace.id}`, 'PUT', {
        name: 'Renamed',
        icon: 'rocket',
        expectedRevision: 1,
      });
      expect(renamed.status).toBe(200);
      expect(await renamed.json()).toMatchObject({
        name: 'Renamed',
        icon: 'rocket',
        revision: 2,
      });
      const nameOnly = await send(`/api/workspaces/${workspace.id}`, 'PUT', {
        name: 'Name only',
        expectedRevision: 2,
      });
      expect(nameOnly.status).toBe(200);
      expect(await nameOnly.json()).toMatchObject({
        name: 'Name only',
        icon: 'rocket',
        revision: 3,
      });
      expect(
        (
          await send(`/api/workspaces/${workspace.id}`, 'PUT', {
            name: 'Stale',
            expectedRevision: 1,
          })
        ).status,
      ).toBe(409);
      await send('/api/providers', 'POST', {
        id: 'fixture',
        name: 'Fixture',
        kind: 'custom',
        builtinId: null,
        api: 'openai-completions',
        baseUrl: 'http://127.0.0.1:1/v1',
        enabled: true,
        requiresApiKey: false,
        models: [
          {
            id: 'model',
            name: 'Model',
            api: 'openai-completions',
            contextWindow: 4096,
            maxTokens: 512,
            reasoning: false,
            input: ['text'],
          },
        ],
      });
      const sessionResponse = await send('/api/sessions', 'POST', {
        title: 'Workspace task',
        providerId: 'fixture',
        modelId: 'model',
        thinkingLevel: 'off',
        workspaceId: workspace.id,
        approvalMode: 'read-only',
      });
      expect(sessionResponse.status).toBe(200);
      const snapshot: unknown = await sessionResponse.json();
      if (!Value.Check(SessionSnapshotSchema, snapshot))
        throw new Error('Invalid session response');
      expect(snapshot.session).toMatchObject({
        workspaceId: workspace.id,
        approvalMode: 'read-only',
      });
      expect(
        (await send(`/api/sessions/${snapshot.session.id}`, 'PUT', { workspaceId: null })).status,
      ).toBe(400);
      expect((await send(`/api/workspaces/${workspace.id}`, 'DELETE', {})).status).toBe(409);
      expect((await send(`/api/sessions/${snapshot.session.id}`, 'DELETE', {})).status).toBe(200);
      expect((await send(`/api/workspaces/${workspace.id}`, 'DELETE', {})).status).toBe(200);
      expect(await (await send('/api/workspaces', 'GET')).json()).toEqual([]);
      expect(await readFile(join(project, 'keep.txt'), 'utf8')).toBe('User data');
    } finally {
      await application.server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
