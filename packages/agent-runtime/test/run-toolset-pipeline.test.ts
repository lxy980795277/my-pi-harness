import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { text as streamText } from 'node:stream/consumers';
import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import { TOOL_DEFINITIONS } from '@my-pi-harness/execution';
import type { ContextUsage } from '@my-pi-harness/protocol';
import type { SessionBatch } from '@my-pi-harness/storage';
import { describe, expect, it, vi } from 'vitest';
import { decodeContextMessage } from '../src/context-codec.js';
import { estimateContextUsage } from '../src/context/budget.js';
import { SESSION_TOOL_DEFINITIONS } from '../src/session-tools.js';
import { RunToolset, type RunToolDefinition, type RunToolSource } from '../src/run-toolset.js';
import { call, fixture, idle } from './support/work-fixture.js';

interface AcceptedTools {
  tools: RunToolDefinition[];
  toolSources: { name: string; source: RunToolSource; fingerprint: string }[];
}

async function records(f: Awaited<ReturnType<typeof fixture>>) {
  const content = await streamText(f.store.exportSessionLog(f.session.id).content);
  return content
    .trim()
    .split('\n')
    .flatMap((line) => {
      const batch = JSON.parse(line) as SessionBatch;
      return batch.records;
    });
}

function declarations(context: TranscriptContext): RunToolDefinition[] {
  return context.messages.flatMap((message) => {
    if (message.role !== 'system' || message.toolsAdded === undefined) return [];
    return message.toolsAdded;
  });
}

describe('accepted tools through Pi requests, budgets and durable execution', () => {
  it('uses the executor capability selection for audit, actual requests, budget and file execution', async () => {
    const f = await fixture(true, { sessionTools: false });
    try {
      const tools = f.tools;
      if (!tools) throw new Error('Missing tool runtime');
      const selection = vi.spyOn(tools, 'selectToolset');
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
      expect(selection).toHaveBeenCalledTimes(1);
      const committed = await records(f);
      const accepted = committed.find(({ event }) => event.type === 'run.accepted');
      if (!accepted?.privateData) throw new Error('Missing acceptance audit');
      const audit = JSON.parse(accepted.privateData) as AcceptedTools;
      expect(audit.tools).toEqual(JSON.parse(JSON.stringify(TOOL_DEFINITIONS)));
      expect(audit.toolSources.map(({ name, source }) => ({ name, source }))).toEqual(
        TOOL_DEFINITIONS.map(({ name }) => ({ name, source: 'workspace' })),
      );
      const frozen = new RunToolset(
        TOOL_DEFINITIONS.map((definition) => ({ source: 'workspace', definition })),
      );
      expect(audit.toolSources.map(({ fingerprint }) => fingerprint)).toEqual(
        frozen.records.map(({ fingerprint }) => fingerprint),
      );
      expect(contexts).toHaveLength(2);
      for (const context of contexts) expect(declarations(context)).toEqual(audit.tools);
      const prepared = committed.filter(({ event }) => event.type === 'context.prepared');
      expect(prepared).toHaveLength(contexts.length);
      for (const record of prepared) {
        if (!record.privateData) throw new Error('Missing prepared model request');
        const request = JSON.parse(record.privateData) as { messages: string[] };
        const modelTools = request.messages.flatMap((encoded) => {
          const message = decodeContextMessage(encoded);
          if (message.role !== 'system' || message.toolsAdded === undefined) return [];
          return message.toolsAdded;
        });
        expect(modelTools).toEqual(audit.tools);
        const usage = record.event.data['usage'] as ContextUsage;
        expect(usage.categories.tools).toBe(
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
    },
    {
      name: 'session and workspace tools',
      workspace: true,
      options: {},
      session: true,
      files: true,
    },
    {
      name: 'no executor session capabilities or workspace',
      workspace: false,
      options: { sessionTools: false },
      session: false,
      files: false,
    },
    {
      name: 'no tool runtime',
      workspace: true,
      options: { tools: false },
      session: false,
      files: false,
    },
    {
      name: 'executor work capabilities without context projection',
      workspace: false,
      options: { context: false },
      session: true,
      files: false,
    },
    {
      name: 'workspace tools without work capabilities or context projection',
      workspace: true,
      options: { context: false, sessionTools: false },
      session: false,
      files: true,
    },
  ])('declares exactly the accepted collection with $name', async (scenario) => {
    const f = await fixture(scenario.workspace, scenario.options);
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
      const committed = await records(f);
      const accepted = committed.find(({ event }) => event.type === 'run.accepted');
      if (!accepted?.privateData || !request) throw new Error('Missing request facts');
      const audit = JSON.parse(accepted.privateData) as AcceptedTools;
      const expected: RunToolDefinition[] = [];
      if (scenario.session) expected.push(...SESSION_TOOL_DEFINITIONS);
      if (scenario.files) expected.push(...TOOL_DEFINITIONS);
      expect(audit.tools).toEqual(JSON.parse(JSON.stringify(expected)));
      expect(declarations(request)).toEqual(audit.tools);
      expect(audit.toolSources.map(({ name }) => name)).toEqual(expected.map(({ name }) => name));
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
