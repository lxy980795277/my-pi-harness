import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { finished } from 'node:stream/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Value } from 'typebox/value';
import { SessionArchiveJobSchema, type SessionArchiveJob } from '@my-pi-harness/protocol';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { loadDaemonConfig } from '../src/application/config';
import { createApplicationServices } from '../src/application/services';
import { createDaemonApplication } from '../src/http/server';
import { loginFixture } from './support/login';
import { startToolModel } from '../../../tests/e2e/tool-model-server';

const cleanup: Array<() => Promise<void>> = [];

async function application(directory: string) {
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
  });
  const errors: unknown[] = [];
  const services = await createApplicationServices(config, {
    credentials: createMemoryCredentialStore(),
    onError: (error) => errors.push(error),
    toolSearchEmbedder: {
      embed(_purpose, values) {
        return Promise.resolve(values.map(() => [1, 0]));
      },
    },
  });
  const app = await createDaemonApplication(config, undefined, services);
  const origin = await app.server.listen({ host: '127.0.0.1', port: 0 });
  const authorization = await loginFixture(origin, services);
  cleanup.push(() => app.server.close());
  const headers = {
    Origin: origin,
    Cookie: authorization.cookie,
    'X-CSRF-Token': authorization.csrf,
  };
  const get = (path: string) =>
    fetch(`${origin}${path}`, { headers, signal: AbortSignal.timeout(5000) });
  const post = (path: string, input: unknown, method = 'POST') =>
    fetch(`${origin}${path}`, {
      method,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30000),
    });
  const upload = (id: string, bytes: Uint8Array) =>
    fetch(`${origin}/api/session-archives/imports/${id}/upload`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/gzip' },
      body: bytes,
      signal: AbortSignal.timeout(30000),
    });
  return { config, services, app, origin, headers, get, post, upload, errors };
}
async function job(response: Response): Promise<SessionArchiveJob> {
  expect(response.ok).toBe(true);
  const value: unknown = await response.json();
  if (!Value.Check(SessionArchiveJobSchema, value)) throw new Error('Invalid archive job DTO');
  return value;
}
async function completed(
  app: Awaited<ReturnType<typeof application>>,
  operationId: string,
): Promise<SessionArchiveJob> {
  await vi.waitFor(
    () =>
      expect(app.services.archives.get(operationId).status).not.toMatch(/^(running|publishing)$/),
    { timeout: 10000 },
  );
  return app.services.archives.get(operationId);
}
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('complete session archive HTTP', () => {
  it('keeps the latest completed export available while older downloads retain their files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-archive-leases-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const source = await application(directory);
    const session = source.services.runtime.createSession({
      title: 'Leases',
      providerId: 'fixture',
      modelId: 'model',
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'ask',
    });
    const first = randomUUID(),
      second = randomUUID(),
      third = randomUUID();
    source.services.archives.export(first, session.id);
    await completed(source, first);
    const firstLease = source.services.archives.download(first);
    source.services.archives.export(second, session.id);
    await completed(source, second);
    const secondLease = source.services.archives.download(second);
    try {
      source.services.archives.export(third, session.id);
      expect(await completed(source, third)).toMatchObject({
        status: 'completed',
        downloadAvailable: true,
      });
      firstLease.content.destroy();
      await Promise.allSettled([finished(firstLease.content)]);
      await vi.waitFor(() =>
        expect(source.services.archives.get(first).downloadAvailable).toBe(false),
      );
      expect(source.services.archives.get(third).downloadAvailable).toBe(true);
    } finally {
      firstLease.content.destroy();
      secondLease.content.destroy();
      await Promise.allSettled([finished(firstLease.content), finished(secondLease.content)]);
    }
    expect(source.errors).toEqual([]);
  });

  it('previews, cancels, publishes, reopens and explicitly rebinds an independent profile', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-archive-http-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const model = await startToolModel();
    cleanup.push(() => model.close());
    const sourceDirectory = join(directory, 'source');
    const targetDirectory = join(directory, 'target');
    await mkdir(sourceDirectory);
    await mkdir(targetDirectory);
    const source = await application(sourceDirectory);
    const root = join(directory, 'workspace');
    await mkdir(root);
    const workspace = await source.services.workspaces.create({ rootPath: root });
    const provider = await source.services.gateway.saveProvider({
      name: 'Archive fixture',
      kind: 'custom',
      builtinId: null,
      api: 'openai-completions',
      baseUrl: `${model.origin}/v1`,
      enabled: true,
      requiresApiKey: true,
      models: [
        {
          id: 'archive-model',
          name: 'Archive model',
          api: 'openai-completions',
          contextWindow: 32000,
          maxTokens: 1024,
          reasoning: false,
          input: ['text', 'image'],
        },
      ],
    });
    await source.services.gateway.setApiKey(provider.id, 'synthetic-archive-secret-only');
    const attachment = await source.services.attachments.upload({
      name: 'pixel.png',
      mediaType: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    });
    const session = source.services.runtime.createSession({
      title: '完整归档',
      providerId: provider.id,
      modelId: 'archive-model',
      thinkingLevel: 'off',
      workspaceId: workspace.id,
      approvalMode: 'full-access',
    });
    await source.services.runtime.send(session.id, {
      requestId: 'archive-input',
      mode: 'send',
      text: '创建文件并保留图片',
      attachmentIds: [attachment.id],
    });
    await vi.waitFor(
      () => expect(source.services.runtime.getSnapshot(session.id).session.activeRunId).toBeNull(),
      { timeout: 10000 },
    );
    expect(await readFile(join(root, 'created.txt'), 'utf8')).toBe('Workspace tool result\n');
    const exportId = randomUUID();
    expect(
      (
        await source.post('/api/session-archives/exports', {
          operationId: exportId,
          sessionId: session.id,
        })
      ).status,
    ).toBe(202);
    expect((await completed(source, exportId)).status).toBe('completed');
    const download = await source.get(`/api/session-archives/exports/${exportId}/download`);
    expect(download.status).toBe(200);
    const archive = new Uint8Array(await download.arrayBuffer());
    expect(gunzipSync(archive).includes(Buffer.from('synthetic-archive-secret-only'))).toBe(false);
    const target = await application(targetDirectory);
    const cancelledId = randomUUID();
    const cancelled = await job(await target.upload(cancelledId, archive));
    expect(cancelled.preview?.canImport).toBe(true);
    const stopping = target.services.archives.cancel(cancelledId);
    expect(() =>
      target.services.archives.commit(cancelledId, cancelled.archiveSha256 ?? ''),
    ).toThrow();
    expect((await stopping).status).toBe('cancelled');
    expect(target.services.store.listSessions()).toEqual([]);
    const operationId = randomUUID();
    const preview = await job(await target.upload(operationId, archive));
    expect(preview).toMatchObject({
      status: 'ready',
      preview: { canImport: true, conflictCount: 0 },
    });
    const sha = preview.archiveSha256;
    if (sha === null) throw new Error('Missing archive digest');
    expect(
      (
        await target.post(`/api/session-archives/imports/${operationId}/commit`, {
          archiveSha256: sha,
        })
      ).status,
    ).toBe(202);
    expect((await completed(target, operationId)).status).toBe('completed');
    expect(target.services.store.getSessionExecutionAccess(session.id)).toMatchObject({
      bound: false,
    });
    expect(target.services.store.getSession(session.id)?.approvalMode).toBe('full-access');
    expect(target.services.store.getProvider(provider.id)).toBeUndefined();
    expect(
      target.services.store
        .listProviders()
        .every((entry) => !entry.hasCredential && !entry.configured),
    ).toBe(true);
    expect(target.services.store.listWorkspaces()).toEqual([]);
    expect(target.services.store.getAttachment(attachment.id)?.attachment.id).toBe(attachment.id);
    expect(target.services.store.listFileChanges(session.id).items[0]).toMatchObject({
      undoAvailable: false,
      redoAvailable: false,
    });
    expect(target.services.store.getSessionUsage(session.id).tokens?.totalTokens).toBe(1330);
    expect(
      (
        await target.post(`/api/sessions/${session.id}/inputs`, {
          requestId: randomUUID(),
          mode: 'send',
          text: '不可直接执行',
        })
      ).status,
    ).toBe(409);
    const beforeRequests = model.requests.length;
    await target.app.server.close();
    const reopened = await application(targetDirectory);
    const restored = await job(
      await reopened.get(`/api/session-archives/operations/${operationId}`),
    );
    expect(restored.status).toBe('completed');
    expect(model.requests).toHaveLength(beforeRequests);
    expect(reopened.services.store.getSessionExecutionAccess(session.id).bound).toBe(false);
    const local = await reopened.services.gateway.saveProvider({
      name: 'Current local',
      kind: 'custom',
      builtinId: null,
      api: 'openai-completions',
      baseUrl: `${model.origin}/v1`,
      enabled: true,
      requiresApiKey: false,
      models: [
        {
          id: 'archive-model',
          name: 'Current model',
          api: 'openai-completions',
          contextWindow: 32000,
          maxTokens: 1024,
          reasoning: false,
          input: ['text'],
        },
      ],
    });
    const bound = await reopened.post(
      `/api/sessions/${session.id}/archive-binding`,
      { providerId: local.id, modelId: 'archive-model', thinkingLevel: 'off', workspaceId: null },
      'PUT',
    );
    expect(bound.status, JSON.stringify(await bound.clone().json())).toBe(200);
    expect(reopened.services.store.getSession(session.id)).toMatchObject({
      providerId: local.id,
      workspaceId: null,
      approvalMode: 'ask',
    });
    await reopened.services.runtime.send(session.id, {
      requestId: 'after-import',
      mode: 'send',
      text: '现在用当前模型继续',
    });
    await vi.waitFor(
      () =>
        expect(reopened.services.runtime.getSnapshot(session.id).session.activeRunId).toBeNull(),
      { timeout: 10000 },
    );
    expect(model.requests).toHaveLength(beforeRequests + 1);
    expect(source.errors).toEqual([]);
    expect(target.errors).toEqual([]);
    expect(reopened.errors).toEqual([]);
    expect(await readdir(root)).toEqual(['created.txt']);
    const listing = await reopened.get('/api/session-archives/operations?limit=1');
    expect(listing.status).toBe(200);
    expect(JSON.stringify(await listing.json())).toContain(operationId);
    expect(
      (await fetch(`${reopened.origin}/api/session-archives/operations/${operationId}`)).status,
    ).toBe(401);
    expect((await reopened.get('/api/session-archives/operations?limit=51')).status).toBe(400);
  }, 30000);
});
