import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import { nativeTool, nativeTools } from '../src/tools/catalog.js';
import { selectRunTools } from '../src/tools/selection.js';
import { RunToolset } from '../src/tools/toolset.js';
import { estimateContextUsage } from '../src/context/budget.js';

describe('default declarations and accepted deferred capabilities', () => {
  it('provides a complete delegation entry path and only adds the Skill loader when a directory exists', () => {
    const input = {
      workspaceId: 'workspace',
      work: true,
      skills: false,
      skillDirectory: false,
      agents: true,
    };
    const selected = selectRunTools(input);
    expect(nativeTools()).toHaveLength(28);
    const expected = [
      'read_file',
      'list_files',
      'search_files',
      'write_file',
      'edit_file',
      'shell',
      'web_fetch',
      'ask_user',
      'tool_search',
      'spawn_agent',
      'wait_agents',
    ].filter((name) => name !== 'shell' || process.platform === 'darwin');
    expect(selected.initial.definitions.map(({ name }) => name)).toEqual(expected);
    expect(selected.nativeCandidates).toHaveLength(15);
    const withSkills = selectRunTools({ ...input, skills: true, skillDirectory: true });
    expect(withSkills.initial.definitions).toHaveLength(expected.length + 1);
    expect(withSkills.nativeCandidates).toHaveLength(16);
    expect(
      withSkills.nativeCandidates.every(
        ({ definition }) =>
          !withSkills.initial.definitions.some(({ name }) => name === definition.name),
      ),
    ).toBe(true);
    expect(withSkills.initial.require('load_skill').definition.parameters).toBeDefined();
    const usage = estimateContextUsage([], '', 32768, 4096, withSkills.initial.definitions);
    const all = estimateContextUsage(
      [],
      '',
      32768,
      4096,
      nativeTools().map(({ definition }) => definition),
    );
    expect(usage.categories.tools).toBeLessThan(all.categories.tools);
  });

  it('excludes workspace operations from discovery without suppressing built-in discovery itself', () => {
    const selected = selectRunTools({
      workspaceId: null,
      work: true,
      skills: true,
      skillDirectory: true,
      agents: true,
    });
    expect(selected.initial.definitions.map(({ name }) => name)).toEqual([
      'web_fetch',
      'ask_user',
      'tool_search',
      'load_skill',
      'spawn_agent',
      'wait_agents',
    ]);
    expect(selected.nativeCandidates.every(({ source }) => source.kind === 'session')).toBe(true);
    expect(selected.nativeCandidates.map(({ definition }) => definition.name)).toContain(
      'search_session_history',
    );
    expect(selected.nativeCandidates.map(({ definition }) => definition.name)).not.toContain(
      'office_docx',
    );
  });

  it('keeps waiting and parent communication when a child has reached its delegation depth', () => {
    const root = selectRunTools({
      workspaceId: 'workspace',
      work: true,
      skills: false,
      skillDirectory: false,
      agents: true,
    });
    const deferred = nativeTool('office_docx');
    if (!deferred) throw new Error('Missing Office declaration');
    const parent = new RunToolset([...root.initial.records, deferred]);
    const child = selectRunTools({
      workspaceId: 'workspace',
      work: true,
      skills: false,
      skillDirectory: false,
      agents: true,
      canSpawn: false,
      task: true,
      access: 'read-only',
      inherited: parent,
    });
    const initial = child.initial.definitions.map(({ name }) => name);
    expect(initial).toContain('wait_agents');
    expect(initial).toContain('send_agent_message');
    expect(initial).not.toContain('spawn_agent');
    for (const name of ['write_file', 'edit_file', 'shell', 'office_docx'])
      expect(child.nativeCandidates.map(({ definition }) => definition.name)).not.toContain(name);
    expect(parent.definitions.map(({ name }) => name)).toContain('office_docx');
  });

  it('accepts only an opaque Skill id from the model while retaining hashes in host metadata', () => {
    const parameters = nativeTool('load_skill')?.definition.parameters;
    if (!parameters) throw new Error('Missing loader declaration');
    expect(Value.Check(parameters, { id: 'skill:test' })).toBe(true);
    expect(Value.Check(parameters, { id: 'skill:test', contentHash: 'a'.repeat(64) })).toBe(false);
  });
});
