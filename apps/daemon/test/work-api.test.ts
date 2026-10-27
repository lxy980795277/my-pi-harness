import { createServer } from 'node:http';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AttachmentSchema,
  WorkSnapshotSchema,
  SessionSnapshotSchema,
  type WorkSnapshot,
} from '@my-pi-harness/protocol';
import { createMemoryCredentialStore, sessionLogDirectory } from '@my-pi-harness/storage';
import { Value } from 'typebox/value';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDaemonConfig } from '../src/application/config.js';
import { createDaemonApplication, type DaemonApplication } from '../src/http/server.js';
import {
  createApplicationServices,
  type ApplicationServices,
} from '../src/application/services.js';
import { loginFixture } from './support/login.js';

const fixtures: { directory: string; application: DaemonApplication }[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-work-api-'));
  const root = join(directory, 'workspace');
  await mkdir(root);
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, 'profile', '.my-pi-harness'),
  });
  const services = await createApplicationServices(config, {
    credentials: createMemoryCredentialStore(),
  });
  let application: DaemonApplication | undefined;
  try {
    application = await createDaemonApplication(config, undefined, services);
    const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
    fixtures.push({ directory, application });
    const grant = await loginFixture(origin, services);
    const headers = {
      Origin: origin,
      Cookie: grant.cookie,
      'X-CSRF-Token': grant.csrf,
      'Content-Type': 'application/json',
    };
    const send = (path: string, method = 'GET', body?: unknown): Promise<Response> =>
      fetch(`${origin}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const workspace = await services.workspaces.create({ rootPath: root, name: 'Workspace' });
    for (const id of ['first', 'second']) createSession(services, id, workspace.id);
    return { directory, root, origin, services, send, headers, workspace };
  } catch (error) {
    if (application) await application.server.close();
    else await services.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function createSession(
  services: ApplicationServices,
  id: string,
  workspaceId: string | null = null,
): void {
  services.store.createSession({
    id,
    branchId: `${id}-main`,
    title: id,
    providerId: 'fixture',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId,
    approvalMode: 'ask',
    at: 1,
  });
}

async function work(response: Response): Promise<WorkSnapshot> {
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  if (!Value.Check(WorkSnapshotSchema, body)) throw new Error('Invalid work response');
  return body;
}

afterEach(async () => {
  for (const { directory, application } of fixtures.splice(0)) {
    try {
      await application.server.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe('M3 protected work commands', () => {
  it('rolls back the SQLite projection and freezes writes when the authoritative log cannot be written', async () => {
    const value = await fixture();
    const profile = await realpath(join(value.directory, 'profile'));
    const journal = join(
      sessionLogDirectory(profile, join(profile, '.my-pi-harness')),
      'first.jsonl',
    );
    await rm(journal);
    await mkdir(journal);
    const response = await value.send('/api/sessions/first', 'PUT', { title: 'Already committed' });
    expect(response.status).toBe(503);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ code: 'SESSION_LOG_UNAVAILABLE' });
    expect(body).toHaveProperty('message', expect.stringContaining('重启后确认'));
    expect(value.services.store.getSession('first')?.title).toBe('first');
    const read = await value.send('/api/sessions/first');
    expect(read.status).toBe(200);
    const snapshot: unknown = await read.json();
    expect(snapshot).toMatchObject({ session: { title: 'first' } });
  });

  it('rejects missing branch expectations and stale work requests after switching equal revisions', async () => {
    const f = await fixture();
    expect((await f.send('/api/sessions/first/work')).status).toBe(400);
    expect((await f.send('/api/sessions/first/work?branchId=first-main&extra=true')).status).toBe(
      400,
    );
    const missingBranch = [
      { path: '', method: 'PATCH', body: { revision: 0, mode: 'plan' } },
      { path: '/reset-context', method: 'POST', body: { revision: 0 } },
      { path: '/compact', method: 'POST', body: { revision: 0 } },
      { path: '/checkpoints/missing/restore', method: 'POST', body: { revision: 0 } },
      { path: '/checkpoints', method: 'POST', body: { label: 'Missing branch' } },
    ];
    for (const request of missingBranch)
      expect(
        (await f.send(`/api/sessions/first/work${request.path}`, request.method, request.body))
          .status,
      ).toBe(400);
    await work(
      await f.send('/api/sessions/first/work', 'PATCH', {
        expectedBranchId: 'first-main',
        revision: 0,
        mode: 'plan',
      }),
    );
    const saved = await work(
      await f.send('/api/sessions/first/work/checkpoints', 'POST', {
        expectedBranchId: 'first-main',
        label: 'Original branch',
      }),
    );
    const checkpoint = saved.checkpoints[0];
    if (!checkpoint) throw new Error('Missing checkpoint');
    const stale = { expectedBranchId: saved.state.branchId, revision: saved.state.revision };
    const restored = await work(
      await f.send(`/api/sessions/first/work/checkpoints/${checkpoint.id}/restore`, 'POST', stale),
    );
    expect(restored.state.revision).toBe(stale.revision);
    expect(restored.state.branchId).not.toBe(stale.expectedBranchId);
    const before = f.services.store.getSnapshot('first');
    const requests = [
      { path: '', method: 'PATCH', body: { ...stale, mode: 'execute' } },
      { path: '/reset-context', method: 'POST', body: stale },
      { path: '/compact', method: 'POST', body: stale },
      { path: `/checkpoints/${checkpoint.id}/restore`, method: 'POST', body: stale },
      {
        path: '/checkpoints',
        method: 'POST',
        body: { expectedBranchId: stale.expectedBranchId, label: 'Stale branch' },
      },
    ];
    for (const request of requests) {
      const response = await f.send(
        `/api/sessions/first/work${request.path}`,
        request.method,
        request.body,
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'WORK_CONFLICT' });
    }
    const staleRead = await f.send('/api/sessions/first/work?branchId=first-main');
    expect(staleRead.status).toBe(409);
    expect(await staleRead.json()).toMatchObject({ code: 'WORK_CONFLICT' });
    expect(
      await work(await f.send(`/api/sessions/first/work?branchId=${restored.state.branchId}`)),
    ).toEqual(restored);
    expect(f.services.store.getSnapshot('first')).toEqual(before);
  });

  it('accepts first-session Plan mode before any run and rejects invalid modes', async () => {
    const f = await fixture();
    await f.services.gateway.saveProvider({
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
          contextWindow: 8192,
          maxTokens: 512,
          reasoning: false,
          input: ['text'],
        },
      ],
    });
    const input = {
      title: 'Plan first',
      providerId: 'fixture',
      modelId: 'model',
      thinkingLevel: 'off',
    };
    const created = await f.send('/api/sessions', 'POST', { ...input, workMode: 'plan' });
    expect(created.status).toBe(200);
    const session: unknown = await created.json();
    if (!Value.Check(SessionSnapshotSchema, session)) throw new Error('Invalid session response');
    expect(session.snapshotSeq).toBe(2);
    expect(session.session.activeRunId).toBeNull();
    expect(session.messages).toEqual([]);
    expect(
      (
        await work(
          await f.send(
            `/api/sessions/${session.session.id}/work?branchId=${session.session.activeBranchId}`,
          ),
        )
      ).state,
    ).toMatchObject({ revision: 1, mode: 'plan' });
    expect(f.services.store.readEvents(session.session.id).map(({ type }) => type)).toEqual([
      'session.created',
      'work.updated',
    ]);
    const defaultCreated = await f.send('/api/sessions', 'POST', input);
    expect(defaultCreated.status).toBe(200);
    const defaultSession: unknown = await defaultCreated.json();
    if (!Value.Check(SessionSnapshotSchema, defaultSession))
      throw new Error('Invalid default session response');
    expect(defaultSession.snapshotSeq).toBe(1);
    expect(
      (
        await work(
          await f.send(
            `/api/sessions/${defaultSession.session.id}/work?branchId=${defaultSession.session.activeBranchId}`,
          ),
        )
      ).state,
    ).toMatchObject({ revision: 0, mode: 'execute' });
    const count = f.services.store.listSessions().length;
    expect((await f.send('/api/sessions', 'POST', { ...input, workMode: 'unsafe' })).status).toBe(
      400,
    );
    expect(f.services.store.listSessions()).toHaveLength(count);
  });

  it('requires authorization and CSRF, validates fields and preserves optimistic revisions', async () => {
    const f = await fixture();
    expect((await fetch(`${f.origin}/api/sessions/first/work`)).status).toBe(401);
    const unauthorizedWrite = await fetch(`${f.origin}/api/sessions/first/work`, {
      method: 'PATCH',
      headers: { Origin: f.origin, Cookie: f.headers.Cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: 0, mode: 'plan' }),
    });
    expect(unauthorizedWrite.status).toBe(403);
    expect(
      (await work(await f.send('/api/sessions/first/work?branchId=first-main'))).state,
    ).toMatchObject({
      revision: 0,
      mode: 'execute',
    });
    expect(
      (
        await f.send('/api/sessions/first/work', 'PATCH', {
          expectedBranchId: 'first-main',
          revision: 0,
          mode: 'plan',
          extra: true,
        })
      ).status,
    ).toBe(400);
    const updated = await work(
      await f.send('/api/sessions/first/work', 'PATCH', {
        expectedBranchId: 'first-main',
        revision: 0,
        mode: 'plan',
        todos: [
          {
            id: 'task',
            title: 'Inspect',
            status: 'pending',
            planStepId: null,
            evidenceToolCallIds: [],
            completionNote: null,
          },
        ],
      }),
    );
    expect(updated.state).toMatchObject({
      revision: 1,
      mode: 'plan',
      todos: [{ title: 'Inspect' }],
    });
    const stale = await f.send('/api/sessions/first/work', 'PATCH', {
      expectedBranchId: 'first-main',
      revision: 0,
      mode: 'execute',
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'WORK_CONFLICT' });
    expect(
      (
        await f.send('/api/sessions/first/work/checkpoints', 'POST', {
          expectedBranchId: 'first-main',
          label: 'Snapshot',
          unexpected: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.send('/api/sessions/first/work/reset-context', 'POST', {
          expectedBranchId: 'first-main',
          revision: 1,
          extra: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.send('/api/sessions/first/work/compact', 'POST', {
          expectedBranchId: 'first-main',
          revision: 1,
          extra: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.send('/api/sessions/first/questions/missing/answer', 'POST', {
          answer: 'yes',
          extra: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (await f.send('/api/sessions/first/questions/missing/cancel', 'POST', { extra: true }))
        .status,
    ).toBe(400);
  });

  it('restores a saved state into a new branch, rejects foreign checkpoints and keeps original history', async () => {
    const f = await fixture();
    await work(
      await f.send('/api/sessions/first/work', 'PATCH', {
        expectedBranchId: 'first-main',
        revision: 0,
        mode: 'plan',
      }),
    );
    const seeded = f.services.work.snapshot('first').state;
    f.services.work.save('first', {
      ...seeded,
      plan: {
        id: 'saved-plan',
        runId: null,
        title: 'Plan',
        content: 'Read then implement',
        steps: [{ id: 'step', title: 'Inspect', status: 'pending' }],
        status: 'draft',
        review: null,
        feedback: null,
        updatedAt: 2,
      },
    });
    const saved = await work(
      await f.send('/api/sessions/first/work/checkpoints', 'POST', {
        expectedBranchId: 'first-main',
        label: 'Planning',
      }),
    );
    const checkpoint = saved.checkpoints[0];
    if (!checkpoint) throw new Error('Checkpoint was not saved');
    const wrong = await f.send(
      `/api/sessions/second/work/checkpoints/${checkpoint.id}/restore`,
      'POST',
      { expectedBranchId: 'second-main', revision: 0 },
    );
    expect(wrong.status).toBe(404);
    const reset = await work(
      await f.send('/api/sessions/first/work/reset-context', 'POST', {
        expectedBranchId: saved.state.branchId,
        revision: saved.state.revision,
      }),
    );
    expect(reset.state.plan).toEqual(saved.state.plan);
    const restored = await work(
      await f.send(`/api/sessions/first/work/checkpoints/${checkpoint.id}/restore`, 'POST', {
        expectedBranchId: reset.state.branchId,
        revision: reset.state.revision,
      }),
    );
    expect(restored.state.branchId).not.toBe('first-main');
    expect(restored.state.plan?.title).toBe('Plan');
    expect(f.services.store.getSnapshot('first').branches).toHaveLength(2);
    expect(f.services.store.getWorkState('first', 'first-main').plan).toEqual(saved.state.plan);
    expect(
      f.services.store.readEvents('first').some((event) => event.type === 'branch.restored'),
    ).toBe(true);
  });

  it('loads actual rules and keeps image bytes out of metadata, snapshots and public events', async () => {
    const f = await fixture();
    await writeFile(join(f.root, 'AGENTS.md'), 'Use pnpm for this project.');
    const rules = await f.send(`/api/workspaces/${f.workspace.id}/rules`);
    expect(rules.status).toBe(200);
    expect(await rules.json()).toMatchObject([
      { path: 'AGENTS.md', content: 'Use pnpm for this project.' },
    ]);
    await writeFile(join(f.root, 'AGENTS.md'), 'Run focused checks.');
    expect(await (await f.send(`/api/workspaces/${f.workspace.id}/rules`)).json()).toMatchObject([
      { content: 'Run focused checks.' },
    ]);
    const data = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from('private-image-marker'),
    ]).toString('base64');
    expect((await fetch(`${f.origin}/api/attachments/missing/content`)).status).toBe(401);
    const uploaded = await f.send('/api/attachments', 'POST', {
      name: 'image.png',
      mediaType: 'image/png',
      data,
    });
    expect(uploaded.status).toBe(200);
    const attachment: unknown = await uploaded.json();
    if (!Value.Check(AttachmentSchema, attachment)) throw new Error('Attachment was not uploaded');
    const metadata = await f.send(`/api/attachments/${attachment.id}`);
    expect(await metadata.text()).not.toContain(data);
    expect(await (await f.send(`/api/attachments/${attachment.id}/content`)).json()).toMatchObject({
      imageData: data,
    });
    expect(JSON.stringify(f.services.store.getSnapshot('first'))).not.toContain(data);
    expect(JSON.stringify(f.services.store.readEvents('first'))).not.toContain(data);
    expect(
      (
        await f.send('/api/attachments', 'POST', {
          name: 'image.png',
          mediaType: 'image/png',
          data,
          extra: true,
        })
      ).status,
    ).toBe(400);
  });

  it('answers a pending question once in its own session and cancels the remaining wait', async () => {
    const f = await fixture();
    const runId = 'question-run';
    f.services.store.append('first', [
      {
        type: 'run.accepted',
        at: 2,
        runId,
        data: {
          requestId: 'question-request',
          run: {
            id: runId,
            sessionId: 'first',
            branchId: 'first-main',
            providerId: 'fixture',
            modelId: 'model',
            status: 'running',
            createdAt: 2,
            finishedAt: null,
            error: null,
          },
        },
      },
    ]);
    const controller = new AbortController();
    const pending = f.services.work.ask(
      'first',
      runId,
      'question-call',
      [
        {
          id: 'path',
          header: 'Path',
          prompt: 'Which path?',
          options: [
            { id: 'a', label: 'A', description: '' },
            { id: 'b', label: 'B', description: '' },
          ],
          multiSelect: false,
          allowCustomInput: false,
        },
      ],
      controller.signal,
    );
    try {
      const state = await work(await f.send('/api/sessions/first/work?branchId=first-main'));
      const question = state.state.questions[0];
      if (!question) throw new Error('Question not pending');
      expect(
        (
          await f.send(`/api/sessions/second/questions/${question.id}/answer`, 'POST', {
            answers: [{ questionId: 'path', optionIds: ['a'], text: '' }],
          })
        ).status,
      ).toBe(409);
      const answered = await work(
        await f.send(`/api/sessions/first/questions/${question.id}/answer`, 'POST', {
          answers: [{ questionId: 'path', optionIds: ['a'], text: '' }],
        }),
      );
      expect(answered.state.questions[0]).toMatchObject({
        status: 'answered',
        answers: [{ questionId: 'path', optionIds: ['a'], text: '' }],
      });
      await expect(pending).resolves.toContain('a');
      expect(
        (
          await f.send(`/api/sessions/first/questions/${question.id}/answer`, 'POST', {
            answers: [{ questionId: 'path', optionIds: ['b'], text: '' }],
          })
        ).status,
      ).toBe(409);
      const cancelled = f.services.work.ask(
        'first',
        runId,
        'second-call',
        [
          {
            id: 'continue',
            header: 'Continue',
            prompt: 'Continue?',
            options: [],
            multiSelect: false,
            allowCustomInput: true,
          },
        ],
        controller.signal,
      );
      const expectation = expect(cancelled).rejects.toMatchObject({ code: 'QUESTION_CANCELLED' });
      const second = f.services.work.snapshot('first').state.questions.at(-1);
      if (!second) throw new Error('Second question not pending');
      await work(await f.send(`/api/sessions/first/questions/${second.id}/cancel`, 'POST', {}));
      await expectation;
    } finally {
      controller.abort();
      await Promise.allSettled([pending]);
    }
  });

  it('reviews only the matching pending plan with a current branch revision and keeps the original run', async () => {
    const f = await fixture();
    const runId = 'plan-review-run';
    f.services.store.append('first', [
      {
        type: 'run.accepted',
        at: 2,
        runId,
        data: {
          requestId: 'plan-review-request',
          run: {
            id: runId,
            sessionId: 'first',
            branchId: 'first-main',
            providerId: 'fixture',
            modelId: 'model',
            status: 'running',
            createdAt: 2,
            finishedAt: null,
            error: null,
          },
        },
      },
    ]);
    const controller = new AbortController();
    const pending = f.services.work.proposePlan(
      'first',
      runId,
      'Inspect then implement',
      'Read before editing.',
      [{ id: 'inspect', title: 'Inspect', status: 'pending' }],
      controller.signal,
    );
    try {
      const initial = f.services.work.snapshot('first');
      const planId = initial.state.plan?.id;
      if (!planId) throw new Error('No review plan');
      const input = {
        expectedBranchId: 'first-main',
        revision: initial.state.revision,
        decision: 'approve',
        feedback: '',
      };
      expect(
        (
          await f.send(`/api/sessions/first/work/plans/${planId}/review`, 'POST', {
            ...input,
            revision: input.revision - 1,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await f.send(`/api/sessions/second/work/plans/${planId}/review`, 'POST', {
            ...input,
            expectedBranchId: 'second-main',
            revision: 0,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await f.send('/api/sessions/first/work', 'PATCH', {
            expectedBranchId: 'first-main',
            revision: input.revision,
            plan: { ...initial.state.plan, status: 'approved' },
          })
        ).status,
      ).toBe(400);
      const approved = await work(
        await f.send(`/api/sessions/first/work/plans/${planId}/review`, 'POST', input),
      );
      expect(approved.state).toMatchObject({
        mode: 'execute',
        plan: { id: planId, runId, status: 'approved', review: 'approved' },
      });
      await expect(pending).resolves.toContain('同一次运行');
      expect(f.services.store.getSession('first')?.activeRunId).toBe(runId);
      expect(
        (
          await f.send(`/api/sessions/first/work/plans/${planId}/review`, 'POST', {
            ...input,
            revision: approved.state.revision,
          })
        ).status,
      ).toBe(409);
    } finally {
      controller.abort();
      await Promise.allSettled([pending]);
    }
  });

  it('rejects work edits, reset and checkpoints while a real local model request is active', async () => {
    const f = await fixture();
    let requests = 0;
    const provider = createServer((request, response) => {
      request.resume();
      requests += 1;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(': waiting\n\n');
    });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    try {
      const address = provider.address();
      if (!address || typeof address === 'string') throw new Error('No model fixture address');
      await f.services.gateway.saveProvider({
        id: 'fixture',
        name: 'Fixture',
        kind: 'custom',
        builtinId: null,
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        enabled: true,
        requiresApiKey: false,
        models: [
          {
            id: 'model',
            name: 'Model',
            api: 'openai-completions',
            contextWindow: 8192,
            maxTokens: 512,
            reasoning: false,
            input: ['text'],
          },
        ],
      });
      const sent = await f.send('/api/sessions/first/inputs', 'POST', {
        text: 'Wait',
        mode: 'send',
        requestId: 'running-input',
      });
      expect(sent.status).toBe(200);
      await expect.poll(() => requests, { timeout: 5000 }).toBe(1);
      const state = f.services.work.snapshot('first').state;
      expect(
        (
          await f.send('/api/sessions/first/work', 'PATCH', {
            expectedBranchId: state.branchId,
            revision: state.revision,
            mode: 'plan',
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await f.send('/api/sessions/first/work/reset-context', 'POST', {
            expectedBranchId: state.branchId,
            revision: state.revision,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await f.send('/api/sessions/first/work/checkpoints', 'POST', {
            expectedBranchId: state.branchId,
            label: 'During run',
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await f.send('/api/sessions/first/work/compact', 'POST', {
            expectedBranchId: state.branchId,
            revision: state.revision,
          })
        ).status,
      ).toBe(409);
    } finally {
      await f.services.runtime.cancel('first');
      provider.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        provider.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
