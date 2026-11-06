import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import { nativeTools } from '@my-pi-harness/tools';
import { describe, expect, it, vi } from 'vitest';
import { decodeContextMessage } from '../src/context/codec';
import { estimateContextUsage } from '../src/context/budget';
import { RunToolset, type RunToolDefinition, type RunToolSelection } from '../src/tools/toolset';
import { call, fixture, idle } from './support/work-fixture';
import { acceptedTools, loadedTools } from './support/session-audit';

function declarations(context: TranscriptContext): RunToolDefinition[] {
  return context.messages.flatMap((message) => {
    if (message.role !== 'system' || message.toolsAdded === undefined) return [];
    return message.toolsAdded;
  });
}

function initialDefinitions(input: {
  network: boolean;
  files: boolean;
  session: boolean;
}): RunToolDefinition[] {
  return nativeTools()
    .filter(
      (entry) =>
        entry.loading === 'default' &&
        entry.available({
          workspace: input.files,
          work: input.session,
          skills: false,
          skillDirectory: false,
          agents: false,
          canSpawn: false,
          images: true,
          platform: process.platform,
        }) &&
        input.network,
    )
    .map((entry) => entry.definition);
}

describe('accepted tools through Pi requests, budgets and durable execution', () => {
  it('keeps selected declarations identical in audit, actual requests, budget and file execution', async () => {
    const f = await fixture(true, { sessionTools: false });
    const appends = vi.spyOn(f.store, 'append');
    try {
      const contexts: TranscriptContext[] = [];
      await writeFile(join(f.root, 'input.txt'), 'Frozen tool selection evidence');
      f.faux.setResponses([
        (context) => {
          contexts.push(context);
          return call('read_file', { path: 'input.txt' });
        },
        (context) => {
          contexts.push(context);
          return fauxAssistantMessage('Read the file');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Read input.txt',
        mode: 'send',
        requestId: 'same-tools',
      });
      await idle(f);
      const committed = appends.mock.calls.flatMap(([, events]) => events);
      const accepted = committed.find(({ type }) => type === 'run.accepted');
      if (!accepted?.privateData) throw new Error('Missing acceptance audit');
      const audit = acceptedTools(accepted.privateData);
      const expected = initialDefinitions({ network: true, files: true, session: false });
      const selections = expected.map(
        (definition): RunToolSelection => ({
          source: {
            kind:
              definition.name === 'web_fetch' || definition.name === 'tool_search'
                ? 'session'
                : 'workspace',
          },
          definition,
        }),
      );
      expect(audit.tools).toEqual(JSON.parse(JSON.stringify(expected)));
      expect(audit.toolSources.map(({ name, source }) => ({ name, source }))).toEqual(
        selections.map(({ definition, source }) => ({ name: definition.name, source })),
      );
      const frozen = new RunToolset(selections);
      expect(audit.toolSources.map(({ fingerprint }) => fingerprint)).toEqual(
        frozen.records.map(({ fingerprint }) => fingerprint),
      );
      expect(contexts).toHaveLength(2);
      for (const context of contexts) expect(declarations(context)).toEqual(audit.tools);
      const prepared = committed.filter(({ type }) => type === 'context.prepared');
      expect(prepared).toHaveLength(contexts.length);
      for (const record of prepared) {
        if (!record.privateData) throw new Error('Missing prepared model request');
        const messages = record.privateData['messages'];
        if (!Array.isArray(messages)) throw new Error('Missing native model messages');
        const modelTools = messages.flatMap((encoded: unknown) => {
          const message = decodeContextMessage(encoded);
          if (message.role !== 'system' || message.toolsAdded === undefined) return [];
          return message.toolsAdded;
        });
        expect(modelTools).toEqual(audit.tools);
        expect(record.data).toHaveProperty(
          'usage.categories.tools',
          estimateContextUsage([], '', 20_000, 1024, audit.tools).categories.tools,
        );
      }
      expect(f.runtime.getSnapshot(f.session.id).tools).toMatchObject([
        { name: 'read_file', status: 'completed' },
      ]);
      expect(f.runtime.getSnapshot(f.session.id).tools[0]?.result).toContain('evidence');
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it.each([
    {
      name: 'session tools without a workspace',
      workspace: false,
      options: {},
      session: true,
      files: false,
      network: true,
    },
    {
      name: 'session and workspace tools',
      workspace: true,
      options: {},
      session: true,
      files: true,
      network: true,
    },
    {
      name: 'network tools without working-state capabilities or workspace',
      workspace: false,
      options: { sessionTools: false },
      session: false,
      files: false,
      network: true,
    },
    {
      name: 'no tool runtime',
      workspace: true,
      options: { tools: false },
      session: false,
      files: false,
      network: false,
    },
    {
      name: 'executor work capabilities without context projection',
      workspace: false,
      options: { context: false },
      session: true,
      files: false,
      network: true,
    },
    {
      name: 'workspace tools without work capabilities or context projection',
      workspace: true,
      options: { context: false, sessionTools: false },
      session: false,
      files: true,
      network: true,
    },
  ])('declares exactly the accepted collection with $name', async (scenario) => {
    const f = await fixture(scenario.workspace, scenario.options);
    const appends = vi.spyOn(f.store, 'append');
    try {
      let request: TranscriptContext | undefined;
      f.faux.setResponses([
        (context) => {
          request = context;
          return fauxAssistantMessage('Finished');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Describe your available tools',
        mode: 'send',
        requestId: 'capability-selection',
      });
      await idle(f);
      const committed = appends.mock.calls.flatMap(([, events]) => events);
      const accepted = committed.find(({ type }) => type === 'run.accepted');
      if (!accepted?.privateData || !request) throw new Error('Missing request facts');
      const audit = acceptedTools(accepted.privateData);
      const expected = initialDefinitions(scenario);
      expect(audit.tools).toEqual(JSON.parse(JSON.stringify(expected)));
      expect(declarations(request)).toEqual(audit.tools);
      expect(audit.toolSources.map(({ name }) => name)).toEqual(expected.map(({ name }) => name));
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('adds a session tool from its accepted candidate before updating the request and budget', async () => {
    const f = await fixture();
    const appends = vi.spyOn(f.store, 'append');
    const contexts: TranscriptContext[] = [];
    try {
      f.faux.setResponses([
        (context) => {
          contexts.push(context);
          return call('tool_search', { query: 'update_todos', limit: 1 });
        },
        (context) => {
          contexts.push(context);
          return call('update_todos', {
            todos: [
              {
                id: 'pending',
                title: 'Continue the task',
                status: 'pending',
                planStepId: null,
                evidenceToolCallIds: [],
                completionNote: null,
              },
            ],
          });
        },
        (context) => {
          contexts.push(context);
          return fauxAssistantMessage('Task recorded');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Track a pending task',
        mode: 'send',
        requestId: 'deferred-session-tool',
      });
      await idle(f);
      const committed = appends.mock.calls.flatMap(([, events]) => events);
      const acceptance = committed.find(({ type }) => type === 'run.accepted');
      const load = committed.find(({ type }) => type === 'run.tools_loaded');
      if (!acceptance?.privateData || !load?.privateData)
        throw new Error('Missing accepted candidate or tool load');
      const initial = acceptedTools(acceptance.privateData).tools;
      expect(initial.map(({ name }) => name)).not.toContain('update_todos');
      const loaded = loadedTools(load.privateData).tools;
      const definitions = loaded.map(({ definition }) => definition);
      const todoDefinition = definitions.find(({ name }) => name === 'update_todos');
      if (!todoDefinition) throw new Error('Missing loaded Todo declaration');
      expect(acceptance.privateData['nativeCandidates']).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            definition: todoDefinition,
            source: { kind: 'session' },
          }),
        ]),
      );
      expect(load.privateData['tools']).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            definition: todoDefinition,
            source: { kind: 'session' },
          }),
        ]),
      );
      expect(contexts).toHaveLength(3);
      const firstRequest = contexts[0];
      if (!firstRequest) throw new Error('Missing initial request');
      expect(declarations(firstRequest)).toEqual(initial);
      for (const context of contexts.slice(1)) expect(declarations(context)).toEqual(definitions);
      const prepared = committed.filter(({ type }) => type === 'context.prepared');
      expect(prepared).toHaveLength(3);
      for (const record of prepared.slice(1))
        expect(record.data).toHaveProperty(
          'usage.categories.tools',
          estimateContextUsage([], '', 20_000, 1024, definitions).categories.tools,
        );
      const loadedRequest = prepared[1];
      if (!loadedRequest) throw new Error('Missing request after tool loading');
      expect(committed.indexOf(load)).toBeLessThan(committed.indexOf(loadedRequest));
      expect(f.work.snapshot(f.session.id).state.todos).toMatchObject([
        { id: 'pending', status: 'pending' },
      ]);
      expect(f.runtime.getSnapshot(f.session.id).tools).toMatchObject([
        { name: 'tool_search', status: 'completed' },
        { name: 'update_todos', status: 'completed' },
      ]);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('rejects a known workspace tool that is absent from the accepted no-workspace collection', async () => {
    const f = await fixture();
    try {
      f.faux.setResponses([
        call('read_file', { path: 'input.txt' }),
        fauxAssistantMessage('Workspace tool unavailable'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Read a workspace file',
        mode: 'send',
        requestId: 'excluded-route',
      });
      await idle(f);
      expect(f.runtime.getSnapshot(f.session.id).tools).toMatchObject([
        { name: 'read_file', status: 'failed' },
      ]);
      expect(f.runtime.getSnapshot(f.session.id).tools[0]?.result).toContain('not found');
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
