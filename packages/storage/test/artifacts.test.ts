import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import type { Artifact, ToolCallRecord, StoredToolResult } from '@my-pi-harness/protocol';
import {
  openProfileStore,
  sessionLogDirectory,
  type EventInput,
  type ProfileStore,
} from '../src/index';
import { storedToolCallId } from '../src/sessions/projections/tool-intents';
import { ArtifactBlobs } from '../src/artifacts/blobs';
import { PrivateSessionFiles } from '../src/sessions/private-files';

const owned: { directory: string; store: ProfileStore }[] = [];
afterEach(async () => {
  for (const item of owned.splice(0)) {
    item.store.close();
    await rm(item.directory, { recursive: true, force: true });
  }
});
const event = (
  type: string,
  data: EventInput['data'],
  privateData?: EventInput['privateData'],
): EventInput => ({
  type,
  runId: 'run',
  at: 2,
  data,
  ...(privateData === undefined ? {} : { privateData }),
});

async function fixture(external = false) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'artifact-storage-')));
  const profile = join(directory, 'profile');
  const store = await openProfileStore(profile);
  const ownership = { directory, store };
  owned.push(ownership);
  await mkdir(join(directory, 'workspace'));
  store.createWorkspace({
    id: 'workspace',
    name: 'Files',
    icon: 'folder',
    rootPath: join(directory, 'workspace'),
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  store.createSession({
    id: 'session',
    branchId: 'branch',
    title: 'Artifacts',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: 'workspace',
    approvalMode: 'ask',
    at: 1,
  });
  const tool: ToolCallRecord = {
    id: storedToolCallId('run', 'assistant', 'call'),
    sessionId: 'session',
    runId: 'run',
    branchId: 'branch',
    name: 'publish_artifact',
    arguments: { path: 'result.txt' },
    binding: { kind: 'accepted', source: { kind: 'workspace' }, fingerprint: 'a'.repeat(64) },
    dispatch: { state: 'not_applicable' },
    status: 'running',
    summary: 'Publish result',
    result: null,
    diff: null,
    createdAt: 2,
    updatedAt: 2,
  };
  if (external) {
    tool.binding = {
      kind: 'accepted',
      source: {
        kind: 'mcp',
        serverId: 'external',
        serverRevision: 1,
        remoteToolName: 'publish_artifact',
      },
      fingerprint: 'a'.repeat(64),
    };
    tool.dispatch = { state: 'not_started' };
  }
  store.append('session', [
    event('run.accepted', {
      requestId: 'request',
      run: {
        id: 'run',
        sessionId: 'session',
        branchId: 'branch',
        providerId: 'provider',
        modelId: 'model',
        status: 'running',
        createdAt: 2,
        finishedAt: null,
        error: null,
      },
    }),
    event('message.started', {
      id: 'user',
      sessionId: 'session',
      branchId: 'branch',
      runId: 'run',
      role: 'user',
      text: 'Create file',
      thinking: '',
      createdAt: 2,
      status: 'complete',
      stopReason: null,
    }),
    event(
      'message.started',
      {
        id: 'assistant',
        sessionId: 'session',
        branchId: 'branch',
        runId: 'run',
        role: 'assistant',
        text: '',
        thinking: '',
        createdAt: 2,
        status: 'complete',
        stopReason: 'toolUse',
      },
      {
        codecVersion: 1,
        sdkVersion: '1.4.0',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call', name: tool.name, arguments: tool.arguments }],
        },
      },
    ),
    event('tool.requested', { tool }),
  ]);
  const bytes = Buffer.from('registered exact bytes');
  const blob = store.putArtifactBytes(bytes);
  const artifact: Artifact = {
    id: 'artifact',
    sessionId: 'session',
    runId: 'run',
    taskId: null,
    toolCallId: tool.id,
    workspaceId: 'workspace',
    sourcePath: 'result.txt',
    name: 'result.txt',
    mediaType: 'text/plain',
    ...blob,
    createdAt: 2,
  };
  const result: StoredToolResult = {
    toolResultVersion: 1,
    providerCallId: 'call',
    toolName: tool.name,
    content: [{ type: 'text', text: JSON.stringify(artifact) }],
    isError: false,
    at: 2,
    origin: external ? 'server' : 'tool',
    outcome: 'completed',
  };
  const terminal = (publication = artifact): EventInput[] => [
    event('tool.updated', {
      tool: {
        ...tool,
        status: 'completed',
        result: JSON.stringify(publication),
        artifacts: [publication],
        ...(external
          ? { dispatch: { state: 'may_have_started', attemptId: 'attempt', at: 2 } }
          : {}),
      },
    }),
    event(
      'tool.context',
      { branchId: 'branch', afterMessageId: 'assistant', toolCallId: tool.id },
      { ...result, content: [{ type: 'text', text: JSON.stringify(publication) }] },
    ),
    event('artifact.published', { artifact: publication }),
  ];
  return { directory, profile, store, ownership, artifact, bytes, terminal };
}

it('commits publication with its successful terminal and rebuilds it from the journal', async () => {
  const f = await fixture();
  expect(f.store.getArtifact('session', 'artifact')).toBeUndefined();
  f.store.append('session', f.terminal());
  expect(f.store.getArtifact('session', 'artifact')).toEqual(f.artifact);
  expect(f.store.getVisibleTool('session', f.artifact.toolCallId)?.artifacts).toEqual([f.artifact]);
  expect(f.store.getArtifact('another-session', 'artifact')).toBeUndefined();
  const download = f.store.acquireArtifactDownload('session', 'artifact');
  try {
    expect(download.bytes).toEqual(f.bytes);
  } finally {
    download.release();
    download.release();
  }
  f.store.close();
  f.ownership.store = await openProfileStore(f.profile);
  expect(f.ownership.store.getArtifact('session', 'artifact')).toEqual(f.artifact);
  expect(f.ownership.store.collectUnreferencedArtifacts()).toBe(0);
});

it('rejects a dispatched MCP result that invents host artifact metadata', async () => {
  const f = await fixture(true);
  expect(() => f.store.append('session', f.terminal())).toThrow('completed host tool');
  expect(f.store.getArtifact('session', 'artifact')).toBeUndefined();
  expect(f.store.getVisibleTool('session', f.artifact.toolCallId)?.status).toBe('running');
});

it('rejects missing publication facts, fake bytes and a different task without committing a success', async () => {
  const f = await fixture();
  expect(() => f.store.append('session', f.terminal().slice(0, 2))).toThrow('committed together');
  expect(() =>
    f.store.append('session', f.terminal({ ...f.artifact, taskId: 'other-task' })),
  ).toThrow('completed host tool');
  expect(() =>
    f.store.append('session', f.terminal({ ...f.artifact, sha256: 'f'.repeat(64) })),
  ).toThrow();
  expect(f.store.getArtifact('session', 'artifact')).toBeUndefined();
  expect(f.store.getVisibleTool('session', f.artifact.toolCallId)?.status).toBe('running');
  f.store.abandonArtifactPublication(f.artifact.sha256);
  expect(f.store.collectUnreferencedArtifacts()).toBe(f.bytes.length);
});

it('refuses corrupted immutable blobs on download and during recovery', async () => {
  const f = await fixture();
  f.store.append('session', f.terminal());
  const path = join(
    sessionLogDirectory(f.profile, join(f.profile, '.my-pi-harness')),
    'artifacts',
    `${f.artifact.sha256}.blob`,
  );
  await chmod(path, 0o600);
  await writeFile(path, Buffer.alloc(f.bytes.length, 1));
  expect(() => f.store.acquireArtifactDownload('session', 'artifact')).toThrow('checksum');
  f.store.close();
  await expect(openProfileStore(f.profile)).rejects.toThrow('checksum');
});

it('counts unreferenced blobs toward quota and preserves publication and download leases during collection', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'artifact-quota-')));
  const store = await openProfileStore(directory, {
    artifactLimits: { maximumFileBytes: 5, maximumProfileBytes: 7 },
  });
  owned.push({ directory, store });
  const first = store.putArtifactBytes(Buffer.from('1234'));
  expect(() => store.putArtifactBytes(Buffer.from('123456'))).toThrow('single-file');
  expect(() => store.putArtifactBytes(Buffer.from('5678'))).toThrow('quota');
  expect(store.collectUnreferencedArtifacts()).toBe(0);
  store.abandonArtifactPublication(first.sha256);
  expect(store.collectUnreferencedArtifacts()).toBe(4);
  const second = store.putArtifactBytes(Buffer.from('5678'));
  expect(second.sha256).toBe(createHash('sha256').update('5678').digest('hex'));
});

it('keeps an unreferenced blob until its last download releases and collects abandoned restart residue', async () => {
  const f = await fixture();
  f.store.abandonArtifactPublication(f.artifact.sha256);
  const files = new PrivateSessionFiles(f.profile);
  const blobs = new ArtifactBlobs(files);
  try {
    const download = blobs.acquire(f.artifact);
    expect(blobs.collectUnreferenced(new Set())).toBe(0);
    expect(download.bytes).toEqual(f.bytes);
    download.release();
    download.release();
    expect(blobs.collectUnreferenced(new Set())).toBe(f.bytes.length);
  } finally {
    blobs.close();
    files.close();
  }
  const orphan = f.store.putArtifactBytes(Buffer.from('orphan after crash'));
  expect(f.store.collectUnreferencedArtifacts()).toBe(0);
  f.store.close();
  f.ownership.store = await openProfileStore(f.profile);
  expect(f.ownership.store.collectUnreferencedArtifacts()).toBe(orphan.bytes);
});
