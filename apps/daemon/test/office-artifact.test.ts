import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import {
  defaultAgentSettings,
  type MessageView,
  type RunView,
  type SessionSummary,
  type ToolCallView,
} from '@my-pi-harness/protocol';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import { openProfileStore, type EventInput, type ProfileStore } from '@my-pi-harness/storage';
import { describe, expect, it } from 'vitest';
import { registerOfficeArtifactRoute } from '../src/sessions/artifact-route.js';

function taskArtifact(store: ProfileStore, session: SessionSummary, tool: ToolCallView): void {
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
  const { afterMessageId: _anchor, ...record } = tool;
  const source = {
    ...record,
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
    event('tool.requested', { tool: { ...record, status: 'running', result: null } }, 'child'),
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
    event('message.started', message('after-delegation', 'root', 'user'), 'root'),
  ]);
  store.recoverInterrupted();
}

async function fixture(persistTask = false) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-office-download-')));
  const store = await openProfileStore(join(directory, 'profile'));
  const workspace = store.createWorkspace({
    id: 'workspace',
    name: 'Files',
    icon: 'folder',
    rootPath: directory,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  const session = store.createSession({
    id: 'session',
    branchId: 'branch',
    at: 1,
    title: 'Office',
    providerId: 'faux',
    modelId: 'faux',
    thinkingLevel: 'off',
    approvalMode: 'ask',
    workspaceId: workspace.id,
  });
  const bytes = Buffer.from('%PDF-1.4\nOffice delivery fixture\n%%EOF\n');
  const path = '产物.pdf';
  await writeFile(join(directory, path), bytes);
  const artifact = {
    path,
    format: 'pdf',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    validation: ['delivery fixture'],
    notVerified: ['not a visual check'],
  };
  const tool: ToolCallView = {
    id: 'tool',
    sessionId: session.id,
    branchId: session.activeBranchId,
    runId: 'run',
    name: 'office_pdf',
    arguments: { output: path },
    binding: { kind: 'accepted', source: { kind: 'workspace' }, fingerprint: 'a'.repeat(64) },
    dispatch: { state: 'not_applicable' },
    status: 'completed',
    summary: 'Published file',
    result: JSON.stringify({ artifact, report: {} }),
    diff: null,
    createdAt: 2,
    updatedAt: 3,
    afterMessageId: 'assistant',
  };
  const server = Fastify();
  let unavailable = false;
  if (persistTask) taskArtifact(store, session, tool);
  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof RuntimeError)
      return reply
        .code(
          error.code === 'SESSION_UNAVAILABLE' ? 503 : error.code.includes('CONFLICT') ? 409 : 404,
        )
        .send({ code: error.code });
    return reply.code(400).send({ code: 'INVALID_REQUEST' });
  });
  registerOfficeArtifactRoute(
    server,
    {
      getSessionSummary: (id) => {
        if (unavailable) throw new RuntimeError('SESSION_UNAVAILABLE', 'Persistence failed');
        const head = store.getSession(id);
        if (!head) throw new RuntimeError('SESSION_NOT_FOUND', 'Missing session');
        return head;
      },
    },
    {
      getVisibleTool: (sessionId, toolId) => {
        if (persistTask) return store.getVisibleTool(sessionId, toolId);
        return sessionId === session.id && toolId === tool.id ? tool : undefined;
      },
    },
    {
      requireAvailable: (id) => {
        if (id !== workspace.id) throw new Error('Unknown workspace');
        return Promise.resolve(workspace);
      },
    },
  );
  return {
    server,
    store,
    session,
    directory,
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

describe('Office published artifact HTTP download', () => {
  it('downloads a task artifact only while its delegation remains visible in the current branch', async () => {
    const f = await fixture(true);
    const path = `/api/sessions/${f.session.id}/tools/${f.tool.id}/artifact`;
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
        (await f.server.inject(`/api/sessions/another-session/tools/${f.tool.id}/artifact`))
          .statusCode,
      ).toBe(404);
      f.freeze();
      expect((await f.server.inject(path)).statusCode).toBe(503);
    } finally {
      await f.close();
    }
  });

  it('returns exactly the recorded bytes and a safe unicode attachment filename', async () => {
    const f = await fixture();
    try {
      const response = await f.server.inject('/api/sessions/session/tools/tool/artifact');
      expect(response.statusCode).toBe(200);
      expect(response.rawPayload).toEqual(f.bytes);
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['content-disposition']).toContain(
        "filename*=UTF-8''%E4%BA%A7%E7%89%A9.pdf",
      );
      expect(response.headers['cache-control']).toBe('no-store');
      expect(
        (await f.server.inject('/api/sessions/session/tools/missing/artifact')).statusCode,
      ).toBe(404);
    } finally {
      await f.close();
    }
  });
  it('rejects changed bytes, traversal, symlinks and non-native or incomplete tool records', async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.directory, f.artifact.path), 'changed');
      expect((await f.server.inject('/api/sessions/session/tools/tool/artifact')).statusCode).toBe(
        409,
      );
      for (const path of ['../outside.pdf', '.my-pi-harness/private.pdf']) {
        f.tool.result = JSON.stringify({ artifact: { ...f.artifact, path }, report: {} });
        expect(
          (await f.server.inject('/api/sessions/session/tools/tool/artifact')).statusCode,
        ).not.toBe(200);
      }
      await symlink(join(f.directory, f.artifact.path), join(f.directory, 'alias.pdf'));
      f.tool.result = JSON.stringify({
        artifact: { ...f.artifact, path: 'alias.pdf' },
        report: {},
      });
      expect(
        (await f.server.inject('/api/sessions/session/tools/tool/artifact')).statusCode,
      ).not.toBe(200);
      f.tool.result = JSON.stringify({ artifact: f.artifact, report: {} });
      f.tool.status = 'failed';
      expect((await f.server.inject('/api/sessions/session/tools/tool/artifact')).statusCode).toBe(
        404,
      );
      f.tool.status = 'completed';
      f.tool.binding = {
        kind: 'accepted',
        source: {
          kind: 'mcp',
          serverId: 'server',
          serverRevision: 1,
          remoteToolName: 'office_pdf',
        },
        fingerprint: 'a'.repeat(64),
      };
      expect((await f.server.inject('/api/sessions/session/tools/tool/artifact')).statusCode).toBe(
        404,
      );
    } finally {
      await f.close();
    }
  });
});
