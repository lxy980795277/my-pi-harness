import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OfficeArtifact, ToolCallView } from '@my-pi-harness/protocol';
import {
  readOfficeArtifact,
  officeArtifactFilename,
} from '../src/features/office/utils/office-artifact';
import { downloadOfficeArtifact } from '../src/features/office/services/office-artifacts';

const artifact: OfficeArtifact = {
  path: 'reports/result.docx',
  format: 'docx',
  bytes: 1,
  sha256: 'a'.repeat(64),
  validation: ['package relationships checked'],
  notVerified: ['Rendering unavailable'],
};
const tool = (overrides: Partial<ToolCallView> = {}): ToolCallView => ({
  id: 'tool',
  sessionId: 'session',
  runId: 'run',
  branchId: 'branch',
  afterMessageId: 'assistant',
  binding: { kind: 'accepted', source: { kind: 'workspace' }, fingerprint: 'a'.repeat(64) },
  dispatch: { state: 'not_applicable' },
  name: 'office_docx',
  arguments: { output: artifact.path },
  status: 'completed',
  summary: 'Created document',
  result: `Created document\n${JSON.stringify({ artifact, report: { ok: true } })}`,
  diff: null,
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('recorded Office artifact delivery', () => {
  it('reads a typed artifact only from a completed native Office result', () => {
    expect(readOfficeArtifact(tool())).toEqual(artifact);
    expect(officeArtifactFilename(artifact)).toBe('result.docx');
    expect(readOfficeArtifact(tool({ name: 'web_fetch' }))).toBeNull();
    expect(readOfficeArtifact(tool({ status: 'unknown' }))).toBeNull();
    expect(
      readOfficeArtifact(
        tool({
          binding: {
            kind: 'accepted',
            source: {
              kind: 'mcp',
              serverId: 'server',
              serverRevision: 1,
              remoteToolName: 'office_docx',
            },
            fingerprint: 'a'.repeat(64),
          },
        }),
      ),
    ).toBeNull();
    expect(
      readOfficeArtifact(
        tool({ result: JSON.stringify({ artifact: { ...artifact, sha256: 'invalid' } }) }),
      ),
    ).toBeNull();
    expect(readOfficeArtifact(tool({ result: '<img src=x onerror=alert(1)>' }))).toBeNull();
  });
  it('downloads by recorded session and tool identity, verifying the returned content', async () => {
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
    fetch.mockResolvedValue(
      new Response(bytes, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const blob = await downloadOfficeArtifact(
      'session',
      'tool',
      expected,
      new AbortController().signal,
    );
    expect(await blob.text()).toBe('fixture bytes');
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/sessions/session/tools/tool/artifact');
  });
  it('rejects a file that changed after the recorded successful result', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    fetch.mockImplementation(() =>
      Promise.resolve(
        new Response('x', {
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(
      downloadOfficeArtifact('session', 'tool', artifact, new AbortController().signal),
    ).rejects.toThrow('内容与本次工具记录不一致');
  });
});
