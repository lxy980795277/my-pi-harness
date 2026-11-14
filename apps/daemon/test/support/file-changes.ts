import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallRecord } from '@my-pi-harness/protocol';
import { openProfileStore, type ProfileStore } from '@my-pi-harness/storage';
import type { FileChangeInvocation, ToolResult } from '@my-pi-harness/tools';
import { FileChangeService, type FileChangeOwner } from '../../src/file-changes/service';
import { FileChangeBatches } from '../../src/file-changes/batches';
import { WorkspaceService } from '../../src/workspaces/service';

interface FileChangesFixture {
  directory: string;
  profile: string;
  root: string;
  store: ProfileStore;
  workspaces: WorkspaceService;
  workspace: Awaited<ReturnType<WorkspaceService['create']>>;
  files: FileChangeService;
  batches: FileChangeBatches;
  errors: unknown[];
  owner: FileChangeOwner;
  session(id: string, workspaceId?: string): FileChangeOwner;
  invocation(current?: FileChangeOwner): FileChangeInvocation;
  modify(path: string, content: string, current?: FileChangeOwner): Promise<ToolResult>;
  reopen(): Promise<void>;
  close(): Promise<void>;
}

export const hashBytes = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Real private journal and workspace; only the model tool request is supplied by the fixture. */
export async function fileChangesFixture(): Promise<FileChangesFixture> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-file-change-')));
  const profile = join(directory, 'profile');
  const root = join(directory, 'workspace');
  let store = await openProfileStore(profile).catch(async (error: unknown) => {
    await rm(directory, { recursive: true, force: true });
    throw error;
  });
  try {
    await mkdir(root);
    let workspaces = new WorkspaceService(store, profile);
    const workspace = await workspaces.create({ rootPath: root });
    let files = new FileChangeService({ store, workspaces, profileDirectory: profile });
    const errors: unknown[] = [];
    let batches = new FileChangeBatches({ store, files, onError: (error) => errors.push(error) });
    const session = (id: string, workspaceId = workspace.id): FileChangeOwner => {
      store.createSession({
        id,
        branchId: `branch-${id}`,
        title: id,
        providerId: 'fixture',
        modelId: 'model',
        thinkingLevel: 'off',
        workspaceId,
        approvalMode: 'full-access',
        at: 1,
      });
      store.append(id, [
        {
          type: 'run.accepted',
          runId: `run-${id}`,
          at: 2,
          data: {
            requestId: `request-${id}`,
            run: {
              id: `run-${id}`,
              sessionId: id,
              branchId: `branch-${id}`,
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
      return {
        sessionId: id,
        runId: `run-${id}`,
        branchId: `branch-${id}`,
        workspaceId,
        readOnly: false,
      };
    };
    const owner = session('session');
    const invocation = (current = owner): FileChangeInvocation => {
      const assistantId = randomUUID();
      const callId = randomUUID();
      const toolCallId = hashBytes(
        Buffer.from(JSON.stringify([current.runId, assistantId, callId])),
      );
      const message = {
        id: assistantId,
        sessionId: current.sessionId,
        branchId: current.branchId,
        runId: current.runId,
        role: 'assistant',
        text: '',
        thinking: '',
        createdAt: 3,
        status: 'complete',
        stopReason: 'toolUse',
      };
      const tool: ToolCallRecord = {
        id: toolCallId,
        sessionId: current.sessionId,
        branchId: current.branchId,
        runId: current.runId,
        name: 'write_file',
        arguments: { path: 'file.txt', content: 'fixture', expectedHash: null },
        binding: { kind: 'accepted', source: { kind: 'workspace' }, fingerprint: 'a'.repeat(64) },
        dispatch: { state: 'not_applicable' },
        status: 'running',
        summary: 'Write',
        result: null,
        diff: null,
        createdAt: 3,
        updatedAt: 3,
      };
      store.append(current.sessionId, [
        {
          type: 'message.started',
          runId: current.runId,
          at: 3,
          data: { ...message, status: 'streaming' },
        },
        {
          type: 'message.completed',
          runId: current.runId,
          at: 3,
          data: { message },
          privateData: {
            codecVersion: 1,
            sdkVersion: '1.4.0',
            message: {
              role: 'assistant',
              content: [
                { type: 'toolCall', id: callId, name: tool.name, arguments: tool.arguments },
              ],
            },
          },
        },
        { type: 'tool.requested', runId: current.runId, at: 3, data: { tool } },
      ]);
      return {
        toolCallId,
        signal: new AbortController().signal,
        beforePublish: () => undefined,
        confirmNotPublished: () => undefined,
      };
    };
    const modify = async (path: string, content: string, current = owner) => {
      let expectedHash: string | null = null;
      try {
        expectedHash = hashBytes(await readFile(join(root, path)));
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      return await files.modify(
        current,
        {
          path,
          expectedHash,
          prepare: () => ({
            content: Buffer.from(content),
            result: { summary: 'Written', content: [{ type: 'text', text: 'Written' }] },
          }),
        },
        invocation(current),
      );
    };
    return {
      directory,
      profile,
      root,
      get store() {
        return store;
      },
      get workspaces() {
        return workspaces;
      },
      workspace,
      get files() {
        return files;
      },
      get batches() {
        return batches;
      },
      errors,
      owner,
      session,
      invocation,
      modify,
      async reopen() {
        await batches.close();
        await files.close();
        store.close();
        store = await openProfileStore(profile);
        workspaces = new WorkspaceService(store, profile);
        files = new FileChangeService({ store, workspaces, profileDirectory: profile });
        batches = new FileChangeBatches({ store, files, onError: (error) => errors.push(error) });
      },
      async close() {
        await batches.close();
        await files.close();
        store.close();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    store.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
