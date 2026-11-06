import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';
import { completeToolRegistration, nativeTools, ToolRegistry } from '@my-pi-harness/tools';
import type { SessionSummary } from '@my-pi-harness/protocol';
import { ToolRuntime } from '../src/tools/runtime.js';
import type { ToolRunContext } from '../src/tools/types.js';
import type { EventInput } from '../src/sessions/ports.js';
import { selectRunTools } from '../src/tools/selection.js';
import { RunToolset } from '../src/tools/toolset.js';
import { toolCallRecordId } from '../src/tools/ledger.js';

function context(runId: string, taskId: string | null, events: EventInput[]): ToolRunContext {
  const session: SessionSummary = {
    id: 'session',
    title: 'Contribution test',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: null,
    approvalMode: 'full-access',
    createdAt: 1,
    updatedAt: 1,
    activeBranchId: 'branch',
    activeRunId: 'root-run',
    snapshotSeq: 0,
  };
  return {
    session,
    run: {
      id: runId,
      sessionId: session.id,
      branchId: 'branch',
      providerId: 'provider',
      modelId: 'model',
      status: 'running',
      createdAt: 1,
      finishedAt: null,
      error: null,
      ...(taskId === null ? {} : { taskId }),
    },
    readOnly: true,
    signal: new AbortController().signal,
    supportsImages: false,
    recorded: new Set(),
    assistantMessageId: () => `${runId}-assistant`,
    commit: (batch) => events.push(...batch),
    persistenceFailure: (error) => {
      throw error;
    },
    outcomeUnknown: (message) => {
      throw new Error(message);
    },
  };
}

const contribution = completeToolRegistration({
  name: 'inspect_owned_domain',
  description: 'Read the calling task identity from an independently contributed tool.',
  parameters: Type.Object(
    { label: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  scope: 'session',
  loading: 'on-demand',
  readOnly: true,
  execute: (ports, args, invocation) => ({
    summary: args.label,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          owner: ports.owner,
          label: args.label,
          toolCallId: invocation.toolCallId,
        }),
      },
    ],
  }),
});

describe('independent tool contributions', () => {
  it('selects and executes a contributed registration through the shared ledger with a fresh owner for each Run', async () => {
    let bindings = 0;
    const registry = new ToolRegistry([
      ...nativeTools(),
      {
        ...contribution,
        bind: (ports) => {
          bindings++;
          return contribution.bind(ports);
        },
      },
    ]);
    const runtime = new ToolRuntime({
      registry,
      profileDirectory: '/unused-profile',
      resolveWorkspace: () =>
        Promise.reject(new Error('A session contribution must not resolve a workspace')),
    });
    const selected = selectRunTools({
      registrations: runtime.registrations,
      workspaceId: null,
      work: false,
      skills: false,
      skillDirectory: false,
      agents: false,
    });
    expect(selected.nativeCandidates.map(({ definition }) => definition.name)).toContain(
      contribution.definition.name,
    );
    expect(selected.initial.definitions.map(({ name }) => name)).not.toContain(
      contribution.definition.name,
    );
    const candidate = selected.nativeCandidates.find(
      ({ definition }) => definition.name === contribution.definition.name,
    );
    if (!candidate) throw new Error('Missing contributed candidate');
    const toolset = new RunToolset([candidate]);
    const rootEvents: EventInput[] = [],
      childEvents: EventInput[] = [];
    const root = context('root-run', null, rootEvents),
      child = context('child-run', 'child-task', childEvents);
    const rootTool = runtime.createTools(root, toolset)[0],
      childTool = runtime.createTools(child, toolset)[0];
    if (!rootTool || !childTool) throw new Error('Missing bound contribution');
    const [rootResult, childResult] = await Promise.all([
      rootTool.execute('root-call', { label: 'Root observation' }),
      childTool.execute('child-call', { label: 'Child observation' }),
    ]);
    expect(rootResult.isError).not.toBe(true);
    expect(childResult.isError).not.toBe(true);
    const rootText = rootResult.content[0],
      childText = childResult.content[0];
    if (rootText?.type !== 'text' || childText?.type !== 'text')
      throw new Error('Missing contribution result text');
    expect(JSON.parse(rootText.text)).toEqual({
      owner: { sessionId: 'session', runId: 'root-run', taskId: null },
      label: 'Root observation',
      toolCallId: toolCallRecordId('root-run', 'root-run-assistant', 'root-call'),
    });
    expect(JSON.parse(childText.text)).toEqual({
      owner: { sessionId: 'session', runId: 'child-run', taskId: 'child-task' },
      label: 'Child observation',
      toolCallId: toolCallRecordId('child-run', 'child-run-assistant', 'child-call'),
    });
    for (const [events, runId] of [
      [rootEvents, 'root-run'],
      [childEvents, 'child-run'],
    ] as const) {
      expect(events.map(({ type }) => type)).toEqual([
        'tool.requested',
        'tool.updated',
        'tool.context',
      ]);
      expect(events.every((event) => event.runId === runId)).toBe(true);
      expect(events[1]?.data).toMatchObject({
        tool: {
          name: contribution.definition.name,
          status: 'completed',
          binding: { kind: 'accepted', source: { kind: 'session' } },
        },
      });
    }
    const repeated = runtime.createTools(root, toolset)[0];
    if (!repeated) throw new Error('Missing repeated binding');
    await repeated.execute('root-next-call', { label: 'Next observation' });
    expect(bindings).toBe(2);
    await runtime.close();
  });

  it('rejects a duplicate name before any tool can be bound or dispatched', () => {
    expect(
      () =>
        new ToolRegistry([
          ...nativeTools(),
          contribution,
          { ...contribution, source: { kind: 'workspace' } },
        ]),
    ).toThrow(expect.objectContaining({ code: 'TOOL_NAME_CONFLICT' }));
  });
});
