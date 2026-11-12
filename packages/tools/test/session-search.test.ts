import { Value } from 'typebox/value';
import { expect, it, vi } from 'vitest';
import { searchSessionsTool } from '../src/tools/search-sessions';
import { readSearchSourceTool } from '../src/tools/read-search-source';
import type { ToolAvailability, ToolContext } from '../src/index';

const availability: ToolAvailability = {
  workspace: false,
  work: false,
  skills: false,
  skillDirectory: false,
  agents: false,
  canSpawn: false,
  sessionSearch: true,
  images: true,
  platform: process.platform,
};
const ports: ToolContext = {
  owner: { sessionId: 'session', runId: 'run', taskId: null },
  readOnly: true,
  workspace: () => Promise.reject(new Error('No filesystem access')),
};

it('keeps historical search and source reads on demand without accepting model scope or grants', () => {
  for (const tool of [searchSessionsTool, readSearchSourceTool]) {
    expect(tool.loading).toBe('on-demand');
    expect(tool.available(availability)).toBe(true);
    expect(tool.available({ ...availability, sessionSearch: false })).toBe(false);
    expect(tool.policy({}, true)).toMatchObject({ approvalRequired: false, mutating: false });
  }
  for (const authority of [
    { scope: { allWorkspaces: true } },
    { ownerUserId: 'other' },
    { includeArchived: true },
    { includeTasks: true },
  ])
    expect(
      Value.Check(searchSessionsTool.definition.parameters, { query: 'old answer', ...authority }),
    ).toBe(false);
  for (const authority of [
    { grant: { kind: 'quote' } },
    { contentHash: 'a'.repeat(64) },
    { target: { branchId: 'other' } },
    { before: 4 },
  ])
    expect(
      Value.Check(readSearchSourceTool.definition.parameters, {
        sourceId: 'source',
        start: 0,
        end: 10,
        ...authority,
      }),
    ).toBe(false);
});

it('passes only the search query or exact source ID and offsets to the root-bound handlers', async () => {
  const search = vi.fn(() =>
    Promise.resolve({
      hits: [],
      mode: 'lexical' as const,
      truncated: false,
      generation: 1,
      watermark: 'a'.repeat(64),
    }),
  );
  const read = vi.fn(() =>
    Promise.resolve({
      source: { id: 'source', kind: 'memory' as const, contentHash: 'b'.repeat(64) },
      target: { kind: 'memory' as const, memoryId: 'memory' },
      start: 2,
      end: 5,
      text: 'abc',
      totalLength: 10,
      origin: 'memory' as const,
      status: 'complete',
      createdAt: 1,
    }),
  );
  const signal = new AbortController().signal;
  await searchSessionsTool.bind({ ...ports, search: { search, read } })(
    { query: 'old answer' },
    { toolCallId: 'search', signal },
  );
  expect(search).toHaveBeenCalledExactlyOnceWith('old answer', 8, signal);
  await readSearchSourceTool.bind({ ...ports, search: { search, read } })(
    { sourceId: 'source', start: 2, end: 5 },
    { toolCallId: 'read', signal },
  );
  expect(read).toHaveBeenCalledExactlyOnceWith('source', 2, 5, signal);
  await expect(
    readSearchSourceTool.bind(ports)(
      { sourceId: 'source', start: 2, end: 5 },
      { toolCallId: 'none', signal },
    ),
  ).rejects.toMatchObject({ code: 'SEARCH_UNAVAILABLE' });
});
