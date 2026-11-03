import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';
import type { FrozenMcpTool } from '../src/tools/external.js';
import { RunCapabilities } from '../src/capabilities/run.js';
import { RunToolset } from '../src/tools/toolset.js';
import { ToolCatalogSearch } from '../src/capabilities/search.js';
import type { EventInput } from '../src/sessions/ports.js';
import type { ExecutionContent } from '@my-pi-harness/execution';

function candidate(index: number): FrozenMcpTool {
  return {
    selection: {
      serverId: 'remote',
      serverRevision: 1,
      remoteToolName: `inspect_${index}`,
      definitionFingerprint: index.toString(16).padStart(64, '0'),
    },
    displayName: `GitHub / inspect_${index}`,
    definition: {
      name: `mcp_${index}`,
      description: 'Read GitHub repositories',
      parameters: Type.Object({}),
    },
    authorization: {
      ownerId: 'owner',
      identityEpoch: 1,
      accessEpoch: 1,
      credentialEpoch: 1,
      grantId: 'grant',
      workspaceId: '',
      workspaceRoot: 'https://fixture.invalid',
      scope: 'full-access',
      startupFingerprint: 'a'.repeat(64),
    },
  };
}

function fixture(initialSize = 1, candidates = Array.from({ length: 20 }, (_, i) => candidate(i))) {
  const events: EventInput[] = [];
  const capabilities = new RunCapabilities({
    runId: 'run',
    workspaceId: null,
    candidates,
    skills: [],
    initial: new RunToolset(
      Array.from({ length: initialSize }, (_, i) => ({
        definition: {
          name: `native_${i}`,
          description: 'Native read',
          parameters: Type.Object({}),
        },
        source: { kind: 'session' as const },
      })),
    ),
    commit: (batch) => events.push(...batch),
    diagnostics: [
      {
        serverId: 'broken',
        name: 'Unavailable service',
        status: 'error',
        toolCount: 0,
        error: { code: 'MCP_DISCOVERY_FAILED', message: 'Directory unavailable; retry connection' },
      },
    ],
  });
  return { capabilities, events };
}

const signal = (): AbortSignal => new AbortController().signal;

function text(content: readonly ExecutionContent[]): string {
  return content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
}

describe('automatic progressive tool discovery', () => {
  it('loads eight by default and reports repeat matches without implicitly paging or writing another revision', async () => {
    const { capabilities, events } = fixture();
    const first = await capabilities.execute('tool_search', { query: 'GitHub' }, signal());
    expect(text(first)).toContain('"availability":"next-model-request"');
    expect(capabilities.active.records).toHaveLength(1);
    expect(events).toEqual([]);
    expect(await capabilities.execute('tool_search', { query: 'GitHub' }, signal())).toEqual(first);
    expect(capabilities.advance()).toBe(true);
    expect(capabilities.active.records).toHaveLength(9);
    expect(new Set(capabilities.active.definitions.map(({ name }) => name)).size).toBe(9);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'run.tools_loaded', data: { revision: 2 } });
    const existing = await capabilities.execute('tool_search', { query: 'GitHub' }, signal());
    expect(text(existing)).toContain('"availability":"already-available"');
    expect(capabilities.advance()).toBe(false);
    expect(capabilities.revision).toBe(2);
    expect(events).toHaveLength(1);
    await capabilities.execute('tool_search', { query: 'mcp_19', limit: 1 }, signal());
    expect(capabilities.advance()).toBe(true);
    expect(capabilities.active.records).toHaveLength(10);
    expect(capabilities.revision).toBe(3);
    capabilities.close();
  });

  it('counts native tools toward the 64-tool ceiling and fills only the remaining slots', async () => {
    const { capabilities } = fixture(61);
    await capabilities.execute('tool_search', { query: 'GitHub', limit: 10 }, signal());
    capabilities.advance();
    expect(capabilities.active.records).toHaveLength(64);
    const existing = await capabilities.execute('tool_search', { query: 'GitHub' }, signal());
    expect(text(existing)).toContain('"availability":"already-available"');
    expect(() => capabilities.ensure(['mcp_19'])).toThrow(
      expect.objectContaining({ code: 'TOOL_LIMIT' }),
    );
    capabilities.close();
  });

  it('rejects blank, noninteger and oversized limits before loading anything', async () => {
    const { capabilities } = fixture();
    for (const args of [
      { query: ' ' },
      { query: 'GitHub', limit: 11 },
      { query: 'GitHub', limit: 0 },
      { query: 'GitHub', limit: 1.5 },
    ])
      await expect(capabilities.execute('tool_search', args, signal())).rejects.toMatchObject({
        code: 'TOOL_ARGUMENTS_INVALID',
      });
    expect(capabilities.advance()).toBe(false);
    capabilities.close();
  });

  it('reports frozen discovery failures with empty results instead of asserting an OAuth failure', async () => {
    const { capabilities } = fixture(1, []);
    const result = await capabilities.execute('tool_search', { query: 'GitHub' }, signal());
    expect(text(result)).toContain('MCP_DISCOVERY_FAILED');
    expect(text(result)).toContain('does not establish an OAuth failure');
    capabilities.close();
  });

  it('does not stage late semantic results after the Run owner has closed', async () => {
    let release: ((vectors: readonly (readonly number[])[]) => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<readonly (readonly number[])[]>((resolve) => {
      release = resolve;
    });
    const search = new ToolCatalogSearch({
      embed: () => {
        entered?.();
        return pending;
      },
    });
    const capabilities = new RunCapabilities({
      runId: 'run',
      workspaceId: null,
      initial: new RunToolset([]),
      candidates: [candidate(1)],
      skills: [],
      search,
      commit: () => undefined,
    });
    const operation = capabilities.execute('tool_search', { query: 'GitHub' }, signal());
    await started;
    capabilities.close();
    release?.([[1, 0]]);
    await expect(operation).rejects.toMatchObject({ code: 'RUN_CLOSED' });
    expect(() => capabilities.advance()).toThrow(expect.objectContaining({ code: 'RUN_CLOSED' }));
  });

  it('discovers an accepted session tool without any MCP candidate and retains its actual source', async () => {
    const events: EventInput[] = [];
    const nativeCandidates = new RunToolset([
      {
        definition: {
          name: 'search_session_history',
          description: 'Search retained session history',
          parameters: Type.Object({ query: Type.String() }),
        },
        source: { kind: 'session' },
      },
    ]).records;
    const capabilities = new RunCapabilities({
      runId: 'native-run',
      workspaceId: null,
      initial: new RunToolset([]),
      candidates: [],
      nativeCandidates,
      skills: [],
      commit: (batch) => events.push(...batch),
    });
    try {
      await capabilities.execute('tool_search', { query: 'search_session_history' }, signal());
      expect(capabilities.active.records).toEqual([]);
      capabilities.advance();
      expect(capabilities.active.require('search_session_history').source).toEqual({
        kind: 'session',
      });
      expect(events[0]?.data['names']).toEqual(['search_session_history']);
    } finally {
      capabilities.close();
    }
  });
});
