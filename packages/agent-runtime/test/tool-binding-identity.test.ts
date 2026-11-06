import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { expect, it } from 'vitest';
import { ToolCallRecordSchema, type SessionSummary } from '@my-pi-harness/protocol';
import { ToolRuntime } from '../src/tools/runtime.js';
import { RunToolset } from '../src/tools/toolset.js';
import type { ExternalTools, FrozenMcpTool } from '../src/tools/external.js';
import type { ToolRunContext } from '../src/tools/types.js';
import type { EventInput } from '../src/sessions/ports.js';

function external(serverId: string): FrozenMcpTool {
  return {
    selection: {
      serverId,
      serverRevision: 1,
      remoteToolName: 'lookup',
      definitionFingerprint: 'a'.repeat(64),
    },
    definition: {
      name: `mcp__${serverId}__lookup`,
      description: 'Look up an item',
      parameters: Type.Object({ key: Type.String() }, { additionalProperties: false }),
    },
    authorization: {
      ownerId: 'owner',
      identityEpoch: 1,
      accessEpoch: 1,
      credentialEpoch: 1,
      grantId: `grant-${serverId}`,
      workspaceId: 'workspace',
      workspaceRoot: '/unused-workspace',
      scope: 'full-access',
      startupFingerprint: 'b'.repeat(64),
    },
  };
}

it('dispatches equal MCP definition fingerprints through their distinct accepted Server bindings', async () => {
  const batches: EventInput[][] = [];
  const actualServers: string[] = [];
  const tools = [external('first'), external('second')];
  const port: ExternalTools = {
    freezeSelections: () => Promise.resolve(tools),
    validateBindings: () => Promise.resolve(),
    restoreBindings: (bindings) => Promise.resolve(bindings),
    assertBindingsCurrent: () => undefined,
    async call(input) {
      const before = batches.length;
      await input.beforeDispatch();
      expect(batches).toHaveLength(before + 1);
      const barrier = batches.at(-1);
      expect(barrier).toHaveLength(1);
      expect(barrier?.[0]?.type).toBe('tool.updated');
      const logged = barrier?.[0]?.data['tool'];
      if (
        !Value.Check(ToolCallRecordSchema, logged) ||
        logged.binding.kind !== 'accepted' ||
        logged.binding.source.kind !== 'mcp'
      )
        throw new Error('Missing accepted MCP dispatch barrier');
      expect(logged.dispatch).toMatchObject({
        state: 'may_have_started',
        attemptId: input.callAttemptId,
      });
      expect(logged.binding.source.serverId).toBe(input.tool.selection.serverId);
      expect(logged.name).toBe(input.tool.definition.name);
      actualServers.push(input.tool.selection.serverId);
      return {
        kind: 'known',
        isError: false,
        content: [{ type: 'text', text: input.tool.selection.serverId }],
        summary: 'Lookup completed',
      };
    },
  };
  const session: SessionSummary = {
    id: 'session',
    title: 'Bindings',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: 'workspace',
    approvalMode: 'full-access',
    createdAt: 1,
    updatedAt: 1,
    activeBranchId: 'branch',
    activeRunId: 'run',
    snapshotSeq: 0,
  };
  const context: ToolRunContext = {
    session,
    run: {
      id: 'run',
      sessionId: session.id,
      branchId: 'branch',
      providerId: 'provider',
      modelId: 'model',
      status: 'running',
      createdAt: 1,
      finishedAt: null,
      error: null,
    },
    readOnly: false,
    signal: new AbortController().signal,
    supportsImages: false,
    recorded: new Set(),
    assistantMessageId: () => 'assistant',
    commit: (events) => {
      batches.push(structuredClone([...events]));
    },
    persistenceFailure: (error) => {
      throw error;
    },
    outcomeUnknown: (message) => {
      throw new Error(message);
    },
  };
  const runtime = new ToolRuntime({
    profileDirectory: '/unused-profile',
    resolveWorkspace: () => Promise.reject(new Error('MCP dispatch must use its accepted binding')),
    externalTools: port,
  });
  const toolset = new RunToolset(
    tools.map((tool) => ({
      definition: tool.definition,
      external: tool,
      source: {
        kind: 'mcp',
        serverId: tool.selection.serverId,
        serverRevision: tool.selection.serverRevision,
        remoteToolName: tool.selection.remoteToolName,
      },
    })),
  );
  try {
    for (const [ordinal, server] of ['first', 'second', 'first'].entries()) {
      const selected = runtime
        .createTools(context, toolset)
        .find((tool) => tool.name === `mcp__${server}__lookup`);
      if (selected === undefined) throw new Error('Missing accepted MCP tool');
      const result = await selected.execute(`call-${ordinal}`, { key: 'item' });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: server }]);
      const terminal = batches.at(-1);
      expect(terminal?.map(({ type }) => type)).toEqual(['tool.updated', 'tool.context']);
      expect(terminal?.[0]?.data['tool']).toMatchObject({
        name: selected.name,
        status: 'completed',
        binding: { source: { kind: 'mcp', serverId: server } },
        dispatch: { state: 'may_have_started' },
      });
      expect(terminal?.[1]?.privateData).toMatchObject({
        origin: 'server',
        outcome: 'completed',
        toolName: selected.name,
      });
    }
    expect(actualServers).toEqual(['first', 'second', 'first']);
  } finally {
    await runtime.close();
  }
});
