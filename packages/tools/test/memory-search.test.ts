import { Value } from 'typebox/value';
import { describe, expect, it, vi } from 'vitest';
import { searchMemoriesTool } from '../src/tools/search-memories';
import type { ToolAvailability, ToolContext } from '../src/index';

const available: ToolAvailability = {
  workspace: false,
  work: true,
  skills: false,
  skillDirectory: false,
  agents: false,
  canSpawn: false,
  memory: true,
  images: true,
  platform: process.platform,
};
const ports: ToolContext = {
  owner: { sessionId: 'session', runId: 'run', taskId: null },
  readOnly: true,
  workspace: () => Promise.reject(new Error('No workspace access required')),
};

describe('memory search tool contribution', () => {
  it('requires host availability and does not accept scope or confirmation authority from the model', () => {
    expect(searchMemoriesTool.loading).toBe('default');
    expect(searchMemoriesTool.available(available)).toBe(true);
    expect(searchMemoriesTool.available({ ...available, memory: false })).toBe(false);
    for (const authority of [
      { ownerUserId: 'another' },
      { allWorkspaces: true },
      { taskId: 'another' },
      { confirmed: true },
    ])
      expect(
        Value.Check(searchMemoriesTool.definition.parameters, { query: 'memory', ...authority }),
      ).toBe(false);
  });

  it('passes only a query, bounded count and cancellation signal to the bound scope', async () => {
    const search = vi.fn(() =>
      Promise.resolve({ entries: [], mode: 'lexical' as const, truncated: false }),
    );
    const signal = new AbortController().signal;
    const invoke = searchMemoriesTool.bind({ ...ports, memory: { search } });
    await invoke({ query: 'preferred language' }, { toolCallId: 'call', signal });
    expect(search).toHaveBeenCalledExactlyOnceWith('preferred language', 8, signal);
    await expect(
      searchMemoriesTool.bind(ports)({ query: 'memory' }, { toolCallId: 'missing', signal }),
    ).rejects.toMatchObject({ code: 'MEMORY_UNAVAILABLE' });
  });
});
