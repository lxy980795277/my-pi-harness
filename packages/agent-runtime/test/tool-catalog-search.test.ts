import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vitest';
import {
  ToolCatalogSearch,
  type ToolSearchDocument,
  type ToolSearchEmbedder,
} from '../src/capabilities/search.js';

function document(
  name: string,
  originalName: string,
  label: string,
  description: string,
): ToolSearchDocument {
  return {
    definition: {
      name,
      description,
      parameters: Type.Object({
        repositoryOwner: Type.String({ description: 'Account that owns the code repository' }),
      }),
    },
    originalName,
    label,
    source: 'mcp',
  };
}

const signal = (): AbortSignal => new AbortController().signal;

describe('tool catalog retrieval', () => {
  it('uses service names, original names and schema properties without requiring every word to match', async () => {
    const github = document(
      'mcp_a_45',
      'search_repositories',
      'GitHub / search_repositories',
      'Locate source projects',
    );
    const calendar = document(
      'mcp_b_97',
      'find_events',
      'Google / find_events',
      'Browse calendar events',
    );
    const search = new ToolCatalogSearch();
    expect((await search.search([calendar, github], 'github', signal()))[0]?.definition.name).toBe(
      github.definition.name,
    );
    expect(
      (
        await search.search([calendar, github], 'GitHub inspect projects unfamiliarword', signal())
      )[0]?.definition.name,
    ).toBe(github.definition.name);
    expect(
      (await search.search([calendar, github], 'repositoryOwner', signal())).map(
        ({ definition }) => definition.name,
      ),
    ).toContain(github.definition.name);
    expect(
      (await search.search([calendar, github], 'search repositories', signal()))[0]?.definition
        .name,
    ).toBe(github.definition.name);
  });

  it('ranks a complete original or model-facing name ahead of descriptions', async () => {
    const exact = document(
      'mcp_verylonghash',
      'get_me',
      'GitHub / get_me',
      'Read the signed in account',
    );
    const mention = document('mcp_other', 'profiles', 'Other / profiles', 'get me get me get me');
    const search = new ToolCatalogSearch();
    expect((await search.search([mention, exact], 'get_me', signal()))[0]?.definition.name).toBe(
      exact.definition.name,
    );
    expect(
      (await search.search([mention, exact], 'mcp_verylonghash', signal()))[0]?.definition.name,
    ).toBe(exact.definition.name);
  });

  it('recognizes plural forms, CamelCase and Chinese task descriptions', async () => {
    const docs = document(
      'mcp_docs',
      'searchDocuments',
      'Documents / searchDocuments',
      '检索工作文档和附件',
    );
    const search = new ToolCatalogSearch();
    expect(await search.search([docs], 'document search', signal())).toHaveLength(1);
    expect(await search.search([docs], '工作文档', signal())).toHaveLength(1);
    expect(await search.search([docs], '   ', signal())).toEqual([]);
    expect(await search.search([docs], 'absentword', signal())).toEqual([]);
  });

  it('finds semantic-only matches, normalizes vectors and reuses document embeddings', async () => {
    const github = document(
      'mcp_github',
      'inspect_user',
      'GitHub / inspect_user',
      'Account lookup',
    );
    const mail = document('mcp_mail', 'messages', 'Google Mail / messages', 'Inbox letters');
    const embed = vi.fn<ToolSearchEmbedder['embed']>((purpose, inputs) =>
      Promise.resolve(
        inputs.map((input) => (purpose === 'query' || input.includes('GitHub') ? [10, 0] : [0, 1])),
      ),
    );
    const search = new ToolCatalogSearch({ embed });
    expect(
      (await search.search([github, mail], 'who am i', signal())).map(
        ({ definition }) => definition.name,
      ),
    ).toEqual(['mcp_github']);
    expect(
      (await search.search([github, mail], 'identify my account', signal()))[0]?.definition.name,
    ).toBe('mcp_github');
    expect(embed.mock.calls.filter(([purpose]) => purpose === 'document')).toHaveLength(1);
  });

  it('bypasses optional inference for exact names and falls back on invalid or failed inference', async () => {
    const tool = document('mcp_exact', 'get_user', 'GitHub / get_user', 'Inspect github account');
    const embed = vi.fn<ToolSearchEmbedder['embed']>(() =>
      Promise.reject(new Error('Model unavailable')),
    );
    const search = new ToolCatalogSearch({ embed });
    expect(await search.search([tool], 'get_user', signal())).toHaveLength(1);
    expect(embed).not.toHaveBeenCalled();
    expect(await search.search([tool], 'GitHub', signal())).toHaveLength(1);
    expect(embed).toHaveBeenCalledOnce();
    const invalid = new ToolCatalogSearch({ embed: () => Promise.resolve([[Number.NaN]]) });
    expect(await invalid.search([tool], 'GitHub', signal())).toHaveLength(1);
  });

  it('propagates caller cancellation instead of treating it as a lexical success', async () => {
    const controller = new AbortController();
    const failure = new Error('Run stopped');
    const search = new ToolCatalogSearch({
      embed: () => {
        controller.abort(failure);
        return Promise.reject(failure);
      },
    });
    await expect(
      search.search(
        [document('mcp_one', 'inspect', 'GitHub', 'Account')],
        'GitHub',
        controller.signal,
      ),
    ).rejects.toBe(failure);
  });

  it('stops waiting when a caller cancels an inference backend that ignores its signal', async () => {
    const controller = new AbortController();
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const search = new ToolCatalogSearch({
      embed: () => {
        entered?.();
        return new Promise(() => undefined);
      },
    });
    const operation = search.search(
      [document('mcp_one', 'inspect', 'GitHub', 'Account')],
      'GitHub',
      controller.signal,
    );
    await started;
    const failure = new Error('Run owner cancelled');
    controller.abort(failure);
    await expect(operation).rejects.toBe(failure);
  });
});
