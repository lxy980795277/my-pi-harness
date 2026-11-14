import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Value } from 'typebox/value';
import { FileChangesPageSchema, FileChangeBatchReceiptSchema } from '@my-pi-harness/protocol';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { loadDaemonConfig } from '../src/application/config';
import { createApplicationServices } from '../src/application/services';
import { createDaemonApplication } from '../src/http/server';
import { loginFixture } from './support/login';
import { startToolModel } from '../../../tests/e2e/tool-model-server';

const cleanup: Array<() => Promise<void>> = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-file-api-'));
  const model = await startToolModel();
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
  });
  const services = await createApplicationServices(config, {
    credentials: createMemoryCredentialStore(),
    toolSearchEmbedder: {
      embed(_purpose, values) {
        return Promise.resolve(values.map(() => [1, 0]));
      },
    },
  });
  let application;
  try {
    application = await createDaemonApplication(config, undefined, services);
    const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
    const owned = application;
    cleanup.push(async () => {
      try {
        await owned.server.close();
      } finally {
        await model.close();
        await rm(directory, { recursive: true, force: true });
      }
    });
    const authorization = await loginFixture(origin, services);
    const root = join(directory, 'workspace');
    await mkdir(root);
    const workspace = await services.workspaces.create({ rootPath: root });
    const provider = await services.gateway.saveProvider({
      name: 'File fixture',
      kind: 'custom',
      builtinId: null,
      api: 'openai-completions',
      baseUrl: `${model.origin}/v1`,
      enabled: true,
      requiresApiKey: true,
      models: [
        {
          id: 'file-model',
          name: 'File model',
          api: 'openai-completions',
          contextWindow: 32000,
          maxTokens: 1024,
          reasoning: false,
          input: ['text'],
        },
      ],
    });
    await services.gateway.setApiKey(provider.id, 'synthetic-file-fixture-only');
    const session = services.runtime.createSession({
      title: 'File API',
      providerId: provider.id,
      modelId: 'file-model',
      thinkingLevel: 'off',
      workspaceId: workspace.id,
      approvalMode: 'full-access',
    });
    await services.runtime.send(session.id, {
      requestId: 'file-api-input',
      mode: 'send',
      text: '创建文件',
    });
    await vi.waitFor(
      () => expect(services.runtime.getSnapshot(session.id).session.activeRunId).toBeNull(),
      { timeout: 10000 },
    );
    const base = `${origin}/api/sessions/${session.id}/file-changes`;
    const headers = { Origin: origin, Cookie: authorization.cookie };
    const get = (path = '') =>
      fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(5000) });
    const post = (path: string, input: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'X-CSRF-Token': authorization.csrf,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(5000),
      });
    return { services, model, root, session, base, get, post };
  } catch (error) {
    if (application === undefined) {
      await services.close();
      await model.close();
      await rm(directory, { recursive: true, force: true });
    }
    throw error;
  }
}

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('file change HTTP and native model path', () => {
  it('persists a real model tool write then exposes protected undo/redo and durable receipt history', async () => {
    const value = await fixture();
    expect(value.model.requests).toHaveLength(2);
    expect(await readFile(join(value.root, 'created.txt'), 'utf8')).toBe('Workspace tool result\n');
    const response = await value.get();
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    if (!Value.Check(FileChangesPageSchema, body)) throw new Error('Invalid file history');
    const item = body.items[0];
    if (item === undefined) throw new Error('Missing real tool file change');
    expect(item).toMatchObject({
      undoAvailable: true,
      before: { exists: false },
      after: { exists: true },
    });
    expect(item.answerInputMessageId).not.toBeNull();
    expect(JSON.stringify(body)).not.toContain(value.root);
    expect(JSON.stringify(body)).not.toMatch(
      /rootIdentity|targetKey|parentIdentity|synthetic-file/,
    );
    const input = {
      operationId: randomUUID(),
      action: 'undo',
      selection: { kind: 'changes', changeIds: [item.changeId] },
    };
    expect((await value.post('/operations', input)).status).toBe(202);
    await vi.waitFor(() =>
      expect(
        value.services.store.getFileChangeBatch(value.session.id, input.operationId).status,
      ).toBe('completed'),
    );
    await expect(readFile(join(value.root, 'created.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const repeat = await value.post('/operations', input);
    expect(repeat.status).toBe(200);
    const receipt: unknown = await repeat.json();
    expect(Value.Check(FileChangeBatchReceiptSchema, receipt)).toBe(true);
    const redo = { ...input, operationId: randomUUID(), action: 'redo' };
    expect((await value.post('/operations', redo)).status).toBe(202);
    await vi.waitFor(() =>
      expect(
        value.services.store.getFileChangeBatch(value.session.id, redo.operationId).status,
      ).toBe('completed'),
    );
    expect(await readFile(join(value.root, 'created.txt'), 'utf8')).toBe('Workspace tool result\n');
    const history = await value.get('/operations');
    expect(history.status).toBe(200);
    expect(JSON.stringify(await history.json())).toContain(redo.operationId);
    expect((await value.get(`/${item.changeId}?side=before&offset=0&maxBytes=1024`)).status).toBe(
      200,
    );
    expect((await value.get('?limit=51')).status).toBe(400);
    expect((await value.get('?unknown=true')).status).toBe(400);
    expect((await value.post('/operations', { ...input, path: '../escape' })).status).toBe(400);
    expect((await fetch(value.base)).status).toBe(401);
  }, 30000);
});
