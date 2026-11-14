import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { expect, it, vi } from 'vitest';
import { loadDaemonConfig } from '../src/application/config';
import { createApplicationServices, type ApplicationServices } from '../src/application/services';
import { createDaemonApplication, type DaemonApplication } from '../src/http/server';
import { loginFixture } from './support/login';

it('keeps imported history readable and refuses direct tool approvals, queue replay and root or task interactions before binding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-import-execution-api-'));
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, 'profile', '.my-pi-harness'),
  });
  let services: ApplicationServices | undefined;
  let application: DaemonApplication | undefined;
  try {
    services = await createApplicationServices(config, {
      credentials: createMemoryCredentialStore(),
    });
    application = await createDaemonApplication(config, undefined, services);
    const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
    const auth = await loginFixture(origin, services);
    const headers = {
      Origin: origin,
      Cookie: auth.cookie,
      'X-CSRF-Token': auth.csrf,
      'Content-Type': 'application/json',
    };
    const send = (path: string, body?: unknown) =>
      fetch(`${origin}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(5000),
      });
    services.store.createSession({
      id: 'imported',
      branchId: 'historical-branch',
      title: 'Imported history',
      providerId: 'old-provider',
      modelId: 'old-model',
      thinkingLevel: 'off',
      approvalMode: 'full-access',
      workspaceId: null,
      at: 1,
    });
    const prefix = services.store.getSnapshot('imported').snapshotSeq;
    services.store.append('imported', [
      {
        type: 'session.imported',
        runId: null,
        at: 2,
        data: {
          operationId: 'import-operation',
          archiveSha256: 'c'.repeat(64),
          importedThroughSeq: prefix,
        },
        privateData: { importOwner: { userId: null } },
      },
    ]);
    const seq = services.store.getSnapshot('imported').snapshotSeq;
    const resolve = vi.spyOn(services.gateway, 'resolve');
    const decide = vi.spyOn(services.tools, 'decide');
    const message = vi.spyOn(services.runtime.subagents.messaging, 'message');
    const history = await send('/api/sessions/imported');
    expect(history.status).toBe(200);
    await history.body?.cancel();
    const question = {
      answers: [{ questionId: 'old-question', optionIds: [], text: 'Old answer' }],
    };
    const attempts = [
      [
        '/api/sessions/imported/inputs',
        { text: 'Continue old history', mode: 'send', requestId: 'fresh-request' },
      ],
      ['/api/sessions/imported/queue/resume', {}],
      ['/api/sessions/imported/tools/old-tool/decision', { decision: 'allow' }],
      [
        '/api/sessions/imported/agents/old-task/messages',
        {
          text: 'Continue old task',
          requestId: 'fresh-task-request',
          expectedRunId: 'old-task-run',
          continue: true,
        },
      ],
      ['/api/sessions/imported/questions/old-question/answer', question],
      ['/api/sessions/imported/agents/old-task/questions/old-question/answer', question],
      [
        '/api/sessions/imported/agents/old-task/plans/old-plan/review',
        { expectedBranchId: 'historical-branch', revision: 0, decision: 'approve', feedback: '' },
      ],
    ] as const;
    for (const [path, body] of attempts) {
      const response = await send(path, body);
      expect(response.status, path).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'SESSION_IMPORT_UNBOUND' });
    }
    expect(resolve).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
    expect(services.store.getSnapshot('imported').snapshotSeq).toBe(seq);
  } finally {
    vi.restoreAllMocks();
    if (application) await application.server.close();
    else await services?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
