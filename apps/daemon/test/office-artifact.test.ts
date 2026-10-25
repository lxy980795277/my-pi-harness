import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import type { ToolCallView } from '@my-pi-harness/protocol';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import { openProfileStore } from '@my-pi-harness/storage';
import { describe, expect, it } from 'vitest';
import { registerOfficeArtifactRoute } from '../src/features/sessions/artifact-route.js';

async function fixture() {
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
  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof RuntimeError)
      return reply.code(error.code.includes('CONFLICT') ? 409 : 404).send({ code: error.code });
    return reply.code(400).send({ code: 'INVALID_REQUEST' });
  });
  registerOfficeArtifactRoute(
    server,
    {
      getSnapshot: (id) => {
        if (id !== session.id) throw new RuntimeError('SESSION_NOT_FOUND', 'Missing session');
        return { ...store.getSnapshot(id), tools: [tool] };
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
    directory,
    tool,
    artifact,
    bytes,
    close: async () => {
      await server.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe('Office published artifact HTTP download', () => {
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
