import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppSettingsSchema,
  SessionSnapshotSchema,
  SessionSummarySchema,
} from '@my-pi-harness/protocol';
import {
  createMemoryCredentialStore,
  ProfileLockedError,
  sessionLogDirectory,
} from '@my-pi-harness/storage';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { expect, it } from 'vitest';
import { startTestModel, type TestModelServer } from '../../../tests/e2e/model-server';
import { loadDaemonConfig } from '../src/application/config';
import { createApplicationServices } from '../src/application/services';
import { createDaemonApplication } from '../src/http/server';
import { loginFixture } from './support/login';

const SessionListSchema = Type.Array(SessionSummarySchema);

it('keeps history and settings when desktop and browser entries sequentially open one profile', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-profile-sharing-'));
  let model: TestModelServer | undefined;
  let closeServices: (() => Promise<void>) | undefined;
  let closeApplication: (() => Promise<void>) | undefined;
  try {
    model = await startTestModel({ reply: () => ({ kind: 'text', text: '共享历史的回复。' }) });
    const environment = {
      MY_PI_HARNESS_PORT: '0',
      MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'shared-profile'),
      MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
    };
    const desktopConfig = loadDaemonConfig({
      ...environment,
      MY_PI_HARNESS_DESKTOP_SECRET: 'synthetic-desktop-owner-secret-000000000000000000',
    });
    const webConfig = loadDaemonConfig(environment);
    expect(webConfig.profileDirectory).toBe(desktopConfig.profileDirectory);
    const desktop = await createApplicationServices(desktopConfig, {
      credentials: createMemoryCredentialStore(),
    });
    closeServices = () => desktop.close();
    const desktopApp = await createDaemonApplication(desktopConfig, undefined, desktop);
    closeApplication = () => desktopApp.server.close();
    const desktopOrigin = await desktopApp.server.listen({ host: '127.0.0.1', port: 0 });
    const desktopClient = await loginFixture(desktopOrigin, desktop);
    const provider = await desktop.gateway.saveProvider({
      name: 'Shared synthetic provider',
      kind: 'custom',
      builtinId: null,
      api: 'openai-completions',
      baseUrl: `${model.origin}/v1`,
      enabled: true,
      requiresApiKey: false,
      models: [
        {
          id: 'shared-model',
          name: 'Shared',
          api: 'openai-completions',
          contextWindow: 32768,
          maxTokens: 1024,
          reasoning: false,
          input: ['text'],
        },
      ],
    });
    const settings = desktop.gateway.saveSettings({
      expectedRevision: desktop.gateway.getSettings().revision,
      defaultModel: { providerId: provider.id, modelId: 'shared-model', thinkingLevel: 'off' },
    });
    const session = desktop.runtime.createSession({
      title: '桌面创建的历史',
      providerId: provider.id,
      modelId: 'shared-model',
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'ask',
    });
    await desktop.runtime.send(session.id, {
      text: '请保留这轮历史。',
      requestId: 'shared-profile-message',
      mode: 'send',
    });
    await expect
      .poll(() => desktop.runtime.getSnapshot(session.id).session.activeRunId, { timeout: 10_000 })
      .toBeNull();
    const completed = desktop.runtime.getSnapshot(session.id);
    expect(completed.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(completed.runs.at(-1)?.status).toBe('completed');
    expect(completed.messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'complete',
      text: '共享历史的回复。',
    });
    expect(model.requests).toHaveLength(1);
    const log = join(
      sessionLogDirectory(
        await realpath(desktopConfig.profileDirectory),
        desktopConfig.sessionLogRoot,
      ),
      `${session.id}.jsonl`,
    );
    const originalLog = await readFile(log);

    await expect(
      createApplicationServices(webConfig, { credentials: createMemoryCredentialStore() }),
    ).rejects.toBeInstanceOf(ProfileLockedError);
    await closeApplication();
    closeApplication = undefined;
    closeServices = undefined;

    const web = await createApplicationServices(webConfig, {
      credentials: createMemoryCredentialStore(),
    });
    closeServices = () => web.close();
    const webApp = await createDaemonApplication(webConfig, undefined, web);
    closeApplication = () => webApp.server.close();
    const webOrigin = await webApp.server.listen({ host: '127.0.0.1', port: 0 });
    const webClient = await loginFixture(webOrigin, web);
    expect(webClient.cookie).not.toBe(desktopClient.cookie);
    const headers = { Cookie: webClient.cookie };
    const listResponse = await fetch(`${webOrigin}/api/sessions`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    const sessions: unknown = await listResponse.json();
    expect(listResponse.status).toBe(200);
    if (!Value.Check(SessionListSchema, sessions)) throw new Error('Invalid shared session list');
    expect(sessions.map((entry) => entry.id)).toEqual([session.id]);
    const snapshotResponse = await fetch(`${webOrigin}/api/sessions/${session.id}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    const snapshot: unknown = await snapshotResponse.json();
    expect(snapshotResponse.status).toBe(200);
    if (!Value.Check(SessionSnapshotSchema, snapshot)) throw new Error('Invalid shared history');
    expect(snapshot.messages).toEqual(completed.messages);
    expect(snapshot.session.activeBranchId).toBe(completed.session.activeBranchId);
    const settingsResponse = await fetch(`${webOrigin}/api/settings`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    const restoredSettings: unknown = await settingsResponse.json();
    expect(settingsResponse.status).toBe(200);
    if (!Value.Check(AppSettingsSchema, restoredSettings))
      throw new Error('Invalid shared settings');
    expect(restoredSettings).toEqual(settings);
    expect(await readFile(log)).toEqual(originalLog);
    expect(model.requests).toHaveLength(1);
  } finally {
    try {
      if (closeApplication) await closeApplication();
      else await closeServices?.();
    } finally {
      try {
        await model?.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
});
