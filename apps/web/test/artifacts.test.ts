import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Artifact, ToolCallView } from '@my-pi-harness/protocol';
import { artifactFilename, readToolArtifacts } from '../src/features/artifacts/utils/artifacts';
import { downloadArtifact } from '../src/features/artifacts/services/artifacts';

const artifact: Artifact = {
  id: 'artifact',
  sessionId: 'session',
  runId: 'run',
  taskId: null,
  toolCallId: 'tool',
  workspaceId: 'workspace',
  sourcePath: 'reports/result.csv',
  name: 'result.csv',
  mediaType: 'text/csv',
  bytes: 1,
  sha256: 'a'.repeat(64),
  createdAt: 1,
};
const tool = (overrides: Partial<ToolCallView> = {}): ToolCallView => ({
  id: 'tool',
  sessionId: 'session',
  runId: 'run',
  branchId: 'branch',
  afterMessageId: 'assistant',
  binding: { kind: 'accepted', source: { kind: 'workspace' }, fingerprint: 'a'.repeat(64) },
  dispatch: { state: 'not_applicable' },
  name: 'publish_artifact',
  arguments: { path: artifact.sourcePath },
  status: 'completed',
  summary: 'Registered file',
  result: 'Registered file',
  artifacts: [artifact],
  diff: null,
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('host-registered artifact delivery', () => {
  it('uses persisted artifact fields for arbitrary media without trusting stdout', () => {
    expect(readToolArtifacts(tool())).toEqual([artifact]);
    expect(artifactFilename(artifact)).toBe('result.csv');
    expect(readToolArtifacts(tool({ name: 'another_producer' }))).toEqual([artifact]);
    expect(readToolArtifacts(tool({ status: 'unknown' }))).toEqual([]);
    const { artifacts: _artifacts, ...unregistered } = tool();
    expect(readToolArtifacts({ ...unregistered, result: JSON.stringify({ artifact }) })).toEqual(
      [],
    );
    expect(artifactFilename({ ...artifact, name: '../unsafe\u0000name.csv' })).toBe(
      'unsafe_name.csv',
    );
  });

  it('downloads by session and artifact identity and verifies the exact snapshot', async () => {
    const bytes = new TextEncoder().encode('fixture bytes');
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const expected = {
      ...artifact,
      bytes: bytes.length,
      sha256: Array.from(hash)
        .map((value) => value.toString(16).padStart(2, '0'))
        .join(''),
    };
    const fetch = vi.fn<typeof globalThis.fetch>();
    fetch.mockResolvedValue(new Response(bytes, { headers: { 'Content-Type': 'text/csv' } }));
    vi.stubGlobal('fetch', fetch);
    const blob = await downloadArtifact(expected, new AbortController().signal);
    expect(await blob.text()).toBe('fixture bytes');
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/sessions/session/artifacts/artifact');
  });

  it('rejects corrupted snapshot bytes and recorded size mismatches', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    fetch.mockImplementation(() =>
      Promise.resolve(new Response('x', { headers: { 'Content-Type': 'text/csv' } })),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(downloadArtifact(artifact, new AbortController().signal)).rejects.toThrow(
      '内容与产物记录不一致',
    );
    await expect(
      downloadArtifact({ ...artifact, bytes: 2 }, new AbortController().signal),
    ).rejects.toThrow('大小与产物记录不一致');
  });
});
