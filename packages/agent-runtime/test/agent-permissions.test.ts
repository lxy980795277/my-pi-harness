import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { observeNativeTool } from './support/native-tool';
import type { FrozenSkill } from '@my-pi-harness/protocol';
import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';
import type { FrozenMcpTool } from '../src/tools/external';
import { agentChanged, agentFixture, agentsIdle, firstTask } from './support/agent-fixture';
import { delegate, hasResult, resultCount, waitForResults } from './support/agent-tools';
import { call } from './support/work-fixture';
import { skillCandidate } from './support/skill-candidate';

describe('task read-only capabilities and inherited approval policy', () => {
  it.each(['full-access', 'ask', 'auto'] as const)(
    'keeps a researcher GET read-only under parent %s and never dispatches its POST',
    async (approvalMode) => {
      const observed = observeNativeTool('web_fetch');
      const fetch = observed.execute.mockResolvedValue({
        content: [{ type: 'text', text: 'Observed weather' }],
        summary: 'Observed weather',
      });
      let reviews = 0;
      const f = await agentFixture({
        approvalMode,
        reviewer: {
          review: (input) => {
            reviews += 1;
            expect(input.session.approvalMode).toBe('auto');
            return Promise.resolve({
              decision: 'allow',
              reason: 'User requested this weather read',
            });
          },
        },
        response: (context) => {
          if (firstTask(context) === 'WEATHER_RESEARCH') {
            if (!hasResult(context, 'web_fetch'))
              return call('web_fetch', { url: 'https://weather.invalid/', method: 'GET' }, 'read');
            if (resultCount(context, 'web_fetch') === 1)
              return call(
                'web_fetch',
                { url: 'https://weather.invalid/', method: 'POST', body: 'must not send' },
                'write',
              );
            return fauxAssistantMessage('Read weather; write rejected');
          }
          if (!hasResult(context, 'spawn_agent'))
            return delegate('Weather research', 'WEATHER_RESEARCH');
          if (!hasResult(context, 'wait_agents')) return waitForResults(context);
          return fauxAssistantMessage('Parent collected read-only weather');
        },
      });
      try {
        await f.runtime.send(f.session.id, {
          text: 'ROOT_WEATHER',
          mode: 'send',
          requestId: approvalMode,
        });
        await agentChanged(
          f,
          () => {
            const task = f.runtime.subagents.list(f.session.id).tasks[0];
            if (!task) return false;
            return f.store
              .getTaskSnapshot(f.session.id, task.id)
              .tools.some((tool) => tool.name === 'web_fetch');
          },
          'Child did not request weather',
        );
        const task = f.runtime.subagents.list(f.session.id).tasks[0];
        if (!task) throw new Error('Missing weather task');
        if (approvalMode === 'ask') {
          await agentChanged(
            f,
            () =>
              f.store.getTaskSnapshot(f.session.id, task.id).tools[0]?.status ===
              'awaiting_approval',
            'Missing inherited human approval',
          );
          expect(fetch).not.toHaveBeenCalled();
          const tool = f.store.getTaskSnapshot(f.session.id, task.id).tools[0];
          if (!tool) throw new Error('Missing weather approval');
          f.tools.decide(f.session.id, tool.id, { decision: 'allow' });
        } else {
          expect(f.store.getTaskSnapshot(f.session.id, task.id).tools[0]?.status).not.toBe(
            'awaiting_approval',
          );
        }
        await agentsIdle(f);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0]?.[2].readOnly).toBe(true);
        const child = f.store.getTaskSnapshot(f.session.id, task.id);
        expect(child.tools.filter((tool) => tool.name === 'web_fetch')).toMatchObject([
          {
            status: 'completed',
            approval: {
              source:
                approvalMode === 'ask' ? 'user' : approvalMode === 'auto' ? 'ai' : 'full-access',
              decision: 'allow',
            },
          },
          { status: 'denied', result: '当前运行仅允许只读操作。' },
        ]);
        expect(reviews).toBe(approvalMode === 'auto' ? 1 : 0);
        expect(f.runtime.getSnapshot(f.session.id).session.approvalMode).toBe(approvalMode);
      } finally {
        await f.close();
        observed.restore();
      }
    },
  );

  it('keeps discovered tools inside the child role and rechecks each MCP invocation without a Skill grant', async () => {
    const read: FrozenMcpTool = {
      selection: {
        serverId: 'service',
        serverRevision: 1,
        remoteToolName: 'mixed',
        definitionFingerprint: 'a'.repeat(64),
      },
      definition: {
        name: 'mcp_read',
        description: 'Scoped remote read',
        parameters: Type.Object(
          { mode: Type.Union([Type.Literal('read'), Type.Literal('write')]) },
          { additionalProperties: false },
        ),
      },
      authorization: {
        ownerId: 'owner',
        identityEpoch: 1,
        accessEpoch: 1,
        credentialEpoch: 1,
        grantId: 'grant',
        readOnlyGrantId: 'read-grant',
        workspaceId: 'workspace',
        workspaceRoot: 'https://fixture.invalid',
        scope: 'full-access',
        startupFingerprint: 'b'.repeat(64),
      },
    };
    const write: FrozenMcpTool = {
      ...read,
      selection: {
        ...read.selection,
        remoteToolName: 'mutate',
        definitionFingerprint: 'c'.repeat(64),
      },
      definition: { ...read.definition, name: 'mcp_write' },
      authorization: { ...read.authorization },
    };
    delete write.authorization.readOnlyGrantId;
    const skill: FrozenSkill = {
      selection: { id: 'skill:readonly', contentHash: 'd'.repeat(64) },
      authorization: { skillEpoch: 1, pluginId: null, pluginEpoch: 0, pluginGeneration: null },
      name: 'Untrusted broader instructions',
      description: 'Requests unavailable tools',
      scope: 'user',
      source: '/synthetic/readonly',
      content: 'Inspect the supplied source.',
      resources: [],
      allowedTools: ['write_file', 'edit_file', 'mcp_write'],
    };
    let grantValid = true;
    let calls = 0;
    const f = await agentFixture({
      workspace: true,
      approvalMode: 'full-access',
      discovery: { freezeCandidates: () => Promise.resolve([read, write]) },
      externalTools: {
        freezeSelections: () => Promise.resolve([]),
        restoreBindings: (tools) => Promise.resolve(tools),
        validateBindings: () => Promise.resolve(),
        assertBindingsCurrent: () => undefined,
        isReadOnlyAuthorized: (_tool, args) => grantValid && args['mode'] === 'read',
        call: async (input) => {
          calls += 1;
          await input.beforeDispatch();
          return {
            kind: 'known',
            isError: false,
            content: [{ type: 'text', text: 'Read evidence' }],
            summary: 'Read evidence',
          };
        },
      },
      skills: {
        freezeCandidates: () => Promise.resolve([skillCandidate(skill)]),
        loadCandidate: () => Promise.resolve(skill),
        list: () => Promise.resolve([]),
        freezeSelections: () => Promise.resolve([skill]),
        validateBindings: () => Promise.resolve(),
        assertBindingsCurrent: () => undefined,
        retainBindings: () => () => undefined,
        loadResource: () => Promise.resolve([]),
      },
      response: (context) => {
        if (firstTask(context) !== 'DYNAMIC_READER') {
          if (!hasResult(context, 'spawn_agent'))
            return delegate('Dynamic reader', 'DYNAMIC_READER');
          if (!hasResult(context, 'wait_agents')) return waitForResults(context);
          return fauxAssistantMessage('Parent verified restricted discovery');
        }
        const visible = context.messages.flatMap((message) =>
          message.role === 'system' ? (message.toolsAdded ?? []).map((tool) => tool.name) : [],
        );
        for (const name of ['write_file', 'edit_file', 'mcp_write'])
          expect(visible).not.toContain(name);
        if (!hasResult(context, 'load_skill'))
          return call('load_skill', { id: skill.selection.id }, 'skill');
        if (resultCount(context, 'tool_search') === 0)
          return call('tool_search', { query: 'mcp_write', limit: 1 }, 'unavailable');
        if (resultCount(context, 'tool_search') === 1)
          return call('tool_search', { query: 'mcp_read', limit: 1 }, 'available');
        const reads = resultCount(context, 'mcp_read');
        if (reads === 0) return call('mcp_read', { mode: 'read' }, 'read');
        if (reads === 1) return call('mcp_read', { mode: 'write' }, 'changed-arguments');
        if (reads === 2) {
          grantValid = false;
          return call('mcp_read', { mode: 'read' }, 'revoked-read-grant');
        }
        return fauxAssistantMessage('Read completed; writes and revoked grant denied');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_DYNAMIC',
        mode: 'send',
        requestId: 'dynamic',
      });
      await agentsIdle(f);
      const task = f.runtime.subagents.list(f.session.id).tasks[0];
      if (!task) throw new Error('Missing dynamic task');
      const child = f.store.getTaskSnapshot(f.session.id, task.id);
      expect(child.runs[0]?.status).toBe('completed');
      expect(child.tools.some((tool) => tool.status === 'awaiting_approval')).toBe(false);
      expect(child.tools.filter((tool) => tool.name === 'mcp_read')).toMatchObject([
        { status: 'completed' },
        { status: 'denied', dispatch: { state: 'not_started' } },
        { status: 'denied', dispatch: { state: 'not_started' } },
      ]);
      expect(calls).toBe(1);
      expect(
        f.store.readEvents(f.session.id).some((event) => event.type === 'run.skill_tools_granted'),
      ).toBe(false);
    } finally {
      await f.close();
    }
  });
});
