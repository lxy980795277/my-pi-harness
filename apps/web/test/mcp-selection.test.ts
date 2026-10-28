import { beforeEach, describe, expect, it } from 'vitest';
import type { McpServerView, McpToolCatalog, McpToolView } from '@my-pi-harness/protocol';
import {
  invalidMcpSelections,
  mcpScope,
  selectMcpTool,
} from '../src/features/mcp/utils/mcp-selection';
import { mcpServerForm, parseMcpServerForm } from '../src/features/mcp/utils/mcp-form';
import { useComposerStore } from '../src/features/sessions/stores/composer';

const server: McpServerView = {
  id: 'server',
  name: 'Local tools',
  transport: 'stdio',
  revision: 3,
  workspaceId: 'workspace',
  command: '/usr/bin/node',
  args: [],
  publicEnvironment: {},
  secretSlots: [],
  enabled: true,
  accessEpoch: 2,
  trustedScopes: ['full-access'],
  connectionState: 'disconnected',
  diagnostic: null,
  createdAt: 1,
  updatedAt: 2,
};
const tool: McpToolView = {
  serverId: 'server',
  serverRevision: 3,
  remoteToolName: 'echo',
  name: 'mcp_alias',
  description: 'Echo',
  definitionFingerprint: 'a'.repeat(64),
  available: true,
  diagnostic: null,
};
const catalog: McpToolCatalog = {
  serverId: 'server',
  serverRevision: 3,
  scope: 'full-access',
  discoveredAt: 2,
  tools: [tool],
};

beforeEach(() => {
  useComposerStore.getState().reset();
});

describe('MCP input selection', () => {
  it('rejects changed definitions, revisions, workspace and isolated authorization rather than rebinding', () => {
    const selection = selectMcpTool(tool);
    expect(
      invalidMcpSelections([selection], [server], [catalog], 'workspace', 'full-access'),
    ).toEqual([]);
    for (const changed of [
      { ...server, revision: 4 },
      { ...server, enabled: false },
      { ...server, trustedScopes: [] },
      { ...server, workspaceId: 'other' },
    ]) {
      expect(
        invalidMcpSelections([selection], [changed], [catalog], 'workspace', 'full-access'),
      ).toEqual([selection]);
    }
    expect(
      invalidMcpSelections(
        [selection],
        [server],
        [{ ...catalog, tools: [{ ...tool, definitionFingerprint: 'b'.repeat(64) }] }],
        'workspace',
        'full-access',
      ),
    ).toEqual([selection]);
    expect(
      invalidMcpSelections([selection], [server], [catalog], 'workspace', 'sandboxed'),
    ).toEqual([selection]);
    expect(invalidMcpSelections([selection], [server], [null], 'workspace', 'full-access')).toEqual(
      [selection],
    );
    expect(selection.definitionFingerprint).toBe('a'.repeat(64));
    expect(mcpScope('ask')).toBe('sandboxed');
    expect(mcpScope('full-access')).toBe('full-access');
  });

  it('keeps the original frozen selection through uncertain first send, navigation and retry', () => {
    const state = useComposerStore.getState();
    const generation = state.newConversationGeneration;
    const selected = [selectMcpTool(tool)];
    state.setMcpSelections(`new:${generation}`, selected);
    const intent = {
      model: { providerId: 'provider', modelId: 'model', thinkingLevel: 'off' as const },
      workspaceId: 'workspace',
      approvalMode: 'full-access' as const,
      input: { text: 'once', mode: 'send' as const, requestId: 'request', mcpTools: selected },
    };
    state.beginNewAttempt(generation, intent);
    state.markNewAttemptCreated(generation, 'session');
    state.setMcpSelections('session', []);
    expect(
      state.prepareInput('session', { ...intent.input, requestId: 'another', mcpTools: [] }),
    ).toEqual(intent.input);
    state.startNewConversation();
    expect(useComposerStore.getState().mcpSelections[`new:${generation}`]).toBeUndefined();
    expect(useComposerStore.getState().pendingInputs['session']?.mcpTools).toEqual(selected);
    state.reset();
    expect(useComposerStore.getState().mcpSelections).toEqual({});
  });

  it('parses public startup configuration without mixing secret values into the form', () => {
    const input = parseMcpServerForm({
      name: ' Example ',
      workspaceId: 'workspace',
      command: '/bin/program',
      args: JSON.stringify(['--stdio', 'argument with spaces', 'embedded\nnewline']),
      publicEnvironment: '{"LANG":"en_US.UTF-8"}',
      secretSlots: '[{"slotId":"credential","environmentName":"API_KEY"}]',
    });
    const reopened = parseMcpServerForm(
      mcpServerForm({
        ...server,
        args: ['', 'embedded\nnewline'],
        secretSlots: [{ slotId: 'slot=with delimiter', environmentName: 'KEY', configured: true }],
      }),
    );
    expect(reopened.args).toEqual(['', 'embedded\nnewline']);
    expect(reopened.secretSlots).toEqual([
      { slotId: 'slot=with delimiter', environmentName: 'KEY' },
    ]);
    expect(input).toMatchObject({
      name: 'Example',
      args: ['--stdio', 'argument with spaces', 'embedded\nnewline'],
      publicEnvironment: { LANG: 'en_US.UTF-8' },
      secretSlots: [{ slotId: 'credential', environmentName: 'API_KEY' }],
    });
    expect(() => {
      parseMcpServerForm({
        name: 'X',
        workspaceId: 'workspace',
        command: '/bin/program',
        args: '[]',
        publicEnvironment: '[]',
        secretSlots: '[]',
      });
    }).toThrow('请检查');
    expect(() => {
      parseMcpServerForm({
        name: 'X',
        workspaceId: 'workspace',
        command: '/bin/program',
        args: '[]',
        publicEnvironment: '{}',
        secretSlots: 'secret without a destination',
      });
    }).toThrow('秘密槽的 JSON 格式无效');
  });
});
