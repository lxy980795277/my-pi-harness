import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';
import type { FrozenMcpTool } from '../src/tools/external';
import { RunToolset } from '../src/tools/toolset';
import { allowedTaskCandidates, allowedTaskTool } from '../src/subagents/policy';
import { selectRunTools } from '../src/tools/selection';

function childTools(parent: RunToolset, access: 'read-only' | 'write'): RunToolset {
  return selectRunTools({
    workspaceId: 'workspace',
    work: true,
    skills: false,
    skillDirectory: false,
    agents: true,
    allows: (tool) => allowedTaskTool(tool, access),
    required: ['send_agent_message'],
    inherited: parent,
  }).initial;
}

function candidate(name: string, readOnly: boolean): FrozenMcpTool {
  return {
    selection: {
      serverId: 'remote',
      serverRevision: 1,
      remoteToolName: name,
      definitionFingerprint: 'a'.repeat(64),
    },
    definition: {
      name,
      description: 'Remote test operation',
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
      startupFingerprint: 'b'.repeat(64),
      ...(readOnly ? { readOnlyGrantId: 'read-grant' } : {}),
    },
  };
}

function parentToolset(candidates: FrozenMcpTool[]): RunToolset {
  return new RunToolset([
    ...['read_file', 'write_file', 'run_command'].map((name) => ({
      source: { kind: 'workspace' as const },
      definition: { name, description: name, parameters: Type.Object({}) },
    })),
    ...[
      'spawn_agent',
      'ask_user',
      'read_tool_result',
      'tool_search',
      'restore_context_checkpoint',
      'unknown_control',
    ].map((name) => ({
      source: { kind: 'session' as const },
      definition: { name, description: name, parameters: Type.Object({}) },
    })),
    ...candidates.map((tool) => ({
      source: {
        kind: 'mcp' as const,
        serverId: tool.selection.serverId,
        serverRevision: tool.selection.serverRevision,
        remoteToolName: tool.selection.remoteToolName,
      },
      definition: tool.definition,
      external: tool,
    })),
  ]);
}

describe('task role capability selection', () => {
  it('keeps accepted fingerprints stable when a filtered toolset is rebuilt for a later request', () => {
    const parent = parentToolset([candidate('read_repository', true)]);
    const child = childTools(parent, 'read-only');
    const copied = new RunToolset(child.records);
    expect(copied.records).toEqual(child.records);
    expect(childTools(child, 'read-only').records).toEqual(child.records);
    expect(child.require('read_file').fingerprint).toBe(parent.require('read_file').fingerprint);
  });

  it('keeps read-only delegation and work interactions without exposing ungranted writes', () => {
    const candidates = [candidate('read_repository', true), candidate('unknown_operation', false)];
    const parent = parentToolset(candidates);
    const child = childTools(parent, 'read-only');
    expect(child.definitions.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'read_file',
        'spawn_agent',
        'ask_user',
        'read_tool_result',
        'tool_search',
        'read_repository',
        'wait_agents',
        'send_agent_message',
      ]),
    );
    for (const name of [
      'write_file',
      'unknown_control',
      'restore_context_checkpoint',
      'unknown_operation',
    ])
      expect(child.definitions.map((tool) => tool.name)).not.toContain(name);
    expect(allowedTaskCandidates(candidates, 'read-only')).toEqual([candidates[0]]);
    expect(parent.definitions.some(({ name }) => name === 'run_command')).toBe(true);
    expect(parent.definitions.some(({ name }) => name === 'unknown_operation')).toBe(true);
  });

  it('retains parent write capabilities while denying root history commands and unknown controls', () => {
    const candidates = [candidate('unknown_operation', false)];
    const child = childTools(parentToolset(candidates), 'write');
    expect(child.definitions.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'read_file',
        'write_file',
        ...(process.platform === 'darwin' ? ['run_command'] : []),
        'spawn_agent',
        'ask_user',
        'read_tool_result',
        'tool_search',
        'unknown_operation',
      ]),
    );
    expect(child.definitions.map(({ name }) => name)).not.toContain('unknown_control');
    expect(child.definitions.map(({ name }) => name)).not.toContain('restore_context_checkpoint');
    expect(allowedTaskCandidates(candidates, 'write')).toEqual(candidates);
  });
});
