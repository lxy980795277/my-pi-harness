import { defaultAgentSettings } from '@my-pi-harness/agent-runtime';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import {
  type Artifact,
  type MessageView,
  type RunView,
  type SessionSummary,
  type ToolCallView,
} from '@my-pi-harness/protocol';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import { openProfileStore, type ProfileStore } from '@my-pi-harness/storage';
import type { EventInput } from '@my-pi-harness/protocol/internal';
import { describe, expect, it } from 'vitest';
import { registerArtifactRoute } from '../src/sessions/artifact-route';

function taskArtifact(
  store: ProfileStore,
  session: SessionSummary,
  tool: ToolCallView,
  artifact: Artifact,
): void {
  const run = (id: string, taskId?: string): RunView => ({
    id,
    sessionId: session.id,
    branchId: session.activeBranchId,
    providerId: session.providerId,
    modelId: session.modelId,
    status: 'running',
    createdAt: 2,
    finishedAt: null,
    error: null,
    ...(taskId === undefined ? {} : { taskId }),
  });
  const message = (id: string, runId: string, role: MessageView['role']): MessageView => ({
    id,
    sessionId: session.id,
    branchId: session.activeBranchId,
    runId,
    role,
    text: '',
    thinking: '',
    createdAt: 2,
    status: 'complete',
    stopReason: role === 'assistant' ? 'toolUse' : null,
  });
  const event = (
    type: string,
    data: EventInput['data'],
    runId: string | null,
    privateData?: EventInput['privateData'],
  ): EventInput => ({ type, data, runId, at: 2, ...(privateData ? { privateData } : {}) });
  const intent = (id: string, name: string, args: Record<string, unknown>) => ({
    codecVersion: 1,
    sdkVersion: '1.1.0',
    message: { role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }] },
  });
  const toolId = (runId: string, anchorId: string, providerCallId: string): string =>
    createHash('sha256')
      .update(JSON.stringify([runId, anchorId, providerCallId]))
      .digest('hex');
  const sourceId = toolId('root', 'delegate', 'spawn-call');
  const role = defaultAgentSettings().roles.find((entry) => entry.id === 'worker');
  if (!role) throw new Error('Missing worker role');
  const args = { title: 'Create a document', task: 'Create a PDF', roleId: role.id };
  tool.id = toolId('child', 'artifact-anchor', 'office-call');
  tool.runId = 'child';
  tool.afterMessageId = 'artifact-anchor';
  artifact.toolCallId = tool.id;
  artifact.runId = tool.runId;
  artifact.taskId = 'task';
  tool.artifacts = [artifact];
  tool.result = JSON.stringify(artifact);
  const { afterMessageId: _anchor, ...record } = tool;
  const { artifacts: _artifacts, ...sourceRecord } = record;
  const source = {
    ...sourceRecord,
    id: sourceId,
    runId: 'root',
    name: 'spawn_agent',
    arguments: args,
    binding: { kind: 'accepted', source: { kind: 'session' }, fingerprint: 'a'.repeat(64) },
    status: 'running',
    result: null,
  };
  store.append(session.id, [
    event('run.accepted', { run: run('root'), requestId: 'root-request' }, 'root'),
    event('message.started', message('before-delegation', 'root', 'user'), 'root'),
    event(
      'message.started',
      message('delegate', 'root', 'assistant'),
      'root',
      intent('spawn-call', 'spawn_agent', args),
    ),
    event('tool.requested', { tool: source }, 'root'),
    event(
      'task.created',
      {
        task: {
          id: 'task',
          sourceToolCallId: sourceId,
          title: args.title,
          role,
          limits: defaultAgentSettings().limits,
          createdAt: 2,
        },
      },
      'root',
    ),
    event('run.accepted', { run: run('child', 'task'), requestId: 'child-request' }, 'child'),
    event(
      'message.started',
      message(tool.afterMessageId, 'child', 'assistant'),
      'child',
      intent('office-call', tool.name, tool.arguments),
    ),
    event(
      'tool.requested',
      { tool: { ...sourceRecord, status: 'running', result: null } },
      'child',
    ),
    event('tool.updated', { tool: record }, 'child'),
    event(
      'tool.context',
      {
        branchId: session.activeBranchId,
        afterMessageId: tool.afterMessageId,
        toolCallId: tool.id,
      },
      'child',
      {
        toolResultVersion: 1,
        providerCallId: 'office-call',
        toolName: tool.name,
        content: [{ type: 'text', text: tool.result }],
        isError: false,
        at: tool.updatedAt,
        origin: 'tool',
        outcome: 'completed',
      },
    ),
    event('artifact.published', { artifact }, 'child'),
    event('message.started', message('after-delegation', 'root', 'user'), 'root'),
  ]);
  store.recoverInterrupted();
}

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-artifact-download-')));
  const profile = join(directory, 'profile');
  const root = join(directory, 'workspace');
  await mkdir(root);
  const store = await openProfileStore(profile);
  const workspace = store.createWorkspace({
    id: 'workspace',
    name: 'Files',
    icon: 'folder',
    rootPath: root,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  const session = store.createSession({
    id: 'session',
    branchId: 'branch',
    at: 1,
    title: 'Artifacts',
    providerId: 'faux',
    modelId: 'faux',
    thinkingLevel: 'off',
    approvalMode: 'ask',
    workspaceId: workspace.id,
  });
  const bytes = Buffer.from('%PDF-1.4\nArtifact delivery fixture\n%%EOF\n');
  await writeFile(join(root, '产物.pdf'), bytes);
  const artifact: Artifact = {
    id: 'artifact',
    sessionId: session.id,
    runId: 'run',
    taskId: null,
    toolCallId: 'tool',
    workspaceId: workspace.id,
    sourcePath: '产物.pdf',
    name: '产物.pdf',
    mediaType: 'application/pdf',
    ...store.putArtifactBytes(bytes),
    createdAt: 2,
  };
  const tool: ToolCallView = {
    id: 'tool',
    sessionId: session.id,
    branchId: session.activeBranchId,
    runId: 'run',
    name: 'publish_artifact',
    arguments: { path: artifact.sourcePath },
    binding: { kind: 'accepted', source: { kind: 'workspace' }, fingerprint: 'a'.repeat(64) },
    dispatch: { state: 'not_applicable' },
    status: 'completed',
    summary: 'Published file',
    result: null,
    diff: null,
    createdAt: 2,
    updatedAt: 3,
    afterMessageId: 'assistant',
  };
  taskArtifact(store, session, tool, artifact);
  const server = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  let unavailable = false;
  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof RuntimeError)
      return reply
        .code(error.code === 'SESSION_UNAVAILABLE' ? 503 : 404)
        .send({ code: error.code });
    return reply.code(400).send({ code: 'INVALID_REQUEST' });
  });
  registerArtifactRoute(
    server,
    {
      getSessionSummary: (id) => {
        if (unavailable) throw new RuntimeError('SESSION_UNAVAILABLE', 'Persistence failed');
        const head = store.getSession(id);
        if (!head) throw new RuntimeError('SESSION_NOT_FOUND', 'Missing session');
        return head;
      },
    },
    store,
  );
  return {
    server,
    store,
    session,
    directory,
    root,
    profile,
    workspace,
    tool,
    artifact,
    bytes,
    freeze: () => {
      unavailable = true;
    },
    close: async () => {
      await server.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe('registered artifact HTTP download', () => {
  it('downloads child artifacts while their delegation is visible and rejects cross-session access', async () => {
    const f = await fixture();
    const path = `/api/sessions/${f.session.id}/artifacts/${f.artifact.id}`;
    try {
      expect(f.store.getSnapshot(f.session.id).tools.some((tool) => tool.id === f.tool.id)).toBe(
        false,
      );
      expect(f.store.getTaskSnapshot(f.session.id, 'task').tools).toContainEqual(f.tool);
      expect((await f.server.inject(path)).rawPayload).toEqual(f.bytes);
      for (const [branchId, forkMessageId, status] of [
        ['retained', 'after-delegation', 200],
        ['pruned', 'before-delegation', 404],
      ] as const) {
        f.store.append(f.session.id, [
          {
            type: 'branch.created',
            runId: null,
            at: 4,
            data: {
              id: branchId,
              sessionId: f.session.id,
              parentId: f.session.activeBranchId,
              forkMessageId,
              createdAt: 4,
            },
          },
          { type: 'branch.selected', runId: null, at: 4, data: { branchId } },
        ]);
        expect((await f.server.inject(path)).statusCode).toBe(status);
      }
      f.store.createSession({
        id: 'another-session',
        branchId: 'another-branch',
        at: 5,
        title: 'Another conversation',
        providerId: 'faux',
        modelId: 'faux',
        thinkingLevel: 'off',
        approvalMode: 'ask',
        workspaceId: f.session.workspaceId,
      });
      expect(
        (await f.server.inject('/api/sessions/another-session/artifacts/artifact')).statusCode,
      ).toBe(404);
      f.freeze();
      expect((await f.server.inject(path)).statusCode).toBe(503);
    } finally {
      await f.close();
    }
  });

  it('downloads original bytes after source edits or deletion and sends a safe unicode filename', async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.root, f.artifact.sourcePath), 'changed after registration');
      const response = await f.server.inject('/api/sessions/session/artifacts/artifact');
      expect(response.statusCode).toBe(200);
      expect(response.rawPayload).toEqual(f.bytes);
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['content-disposition']).toContain(
        "filename*=UTF-8''%E4%BA%A7%E7%89%A9.pdf",
      );
      expect(response.headers['cache-control']).toBe('no-store');
      await rm(join(f.root, f.artifact.sourcePath));
      expect(
        (await f.server.inject('/api/sessions/session/artifacts/artifact')).rawPayload,
      ).toEqual(f.bytes);
      expect((await f.server.inject('/api/sessions/session/artifacts/missing')).statusCode).toBe(
        404,
      );
      expect(
        (await f.server.inject('/api/sessions/session/artifacts/artifact?path=../private'))
          .statusCode,
      ).toBe(400);
    } finally {
      await f.close();
    }
  });

  it('registers workspace files through the host and rejects traversal, links, false types and cancellation', async () => {
    const f = await fixture();
    const { ArtifactService } = await import('../src/artifacts/service');
    const service = new ArtifactService(
      f.store,
      { requireAvailable: () => Promise.resolve(f.workspace) },
      f.profile,
    );
    const invocation = {
      toolCallId: 'new-call',
      signal: new AbortController().signal,
      owner: { sessionId: f.session.id, runId: 'new-run', taskId: null },
      workspaceId: f.workspace.id,
    };
    try {
      const artifact = await service.publish({ path: f.artifact.sourcePath }, invocation);
      expect(artifact.sha256).toBe(f.artifact.sha256);
      expect(artifact.mediaType).toBe('application/pdf');
      expect(f.store.getArtifact(f.session.id, artifact.id)).toBeUndefined();
      await symlink(join(f.root, f.artifact.sourcePath), join(f.root, 'alias.pdf'));
      for (const path of ['../private', '.my-pi-harness/private', 'alias.pdf'])
        await expect(service.publish({ path }, invocation)).rejects.toMatchObject({
          code: 'ARTIFACT_PATH',
        });
      await expect(
        service.publish({ path: f.artifact.sourcePath, mediaType: 'text/plain' }, invocation),
      ).rejects.toMatchObject({ code: 'ARTIFACT_TYPE' });
      await expect(
        service.publish({ path: f.artifact.sourcePath }, { ...invocation, workspaceId: 'other' }),
      ).rejects.toMatchObject({ code: 'ARTIFACT_OWNER' });
      const controller = new AbortController();
      controller.abort();
      await expect(
        service.publish(
          { path: f.artifact.sourcePath },
          { ...invocation, signal: controller.signal },
        ),
      ).rejects.toThrow();
      f.store.abandonArtifactPublication(artifact.sha256);
    } finally {
      await service.close();
      await f.close();
    }
  });
});
