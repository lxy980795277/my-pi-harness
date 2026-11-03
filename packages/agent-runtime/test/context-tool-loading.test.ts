import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';
import { estimateContextUsage } from '../src/context/budget.js';
import { call, fixture, idle, todo } from './support/work-fixture.js';

function definitions(context: TranscriptContext) {
  return context.messages.flatMap((message) =>
    message.role === 'system' ? (message.toolsAdded ?? []) : [],
  );
}

describe('request-owned deferred tool requirements', () => {
  it('keeps context-only working data without promising unavailable work-tool recovery', async () => {
    const f = await fixture(true, { sessionTools: false });
    const contexts: TranscriptContext[] = [];
    try {
      f.faux.models[0].contextWindow = 32_768;
      f.faux.models[0].maxTokens = 512;
      await writeFile(join(f.root, 'large.txt'), 'Retained context-only source.\n'.repeat(600));
      const state = f.work.snapshot(f.session.id).state;
      f.work.save(f.session.id, {
        ...state,
        todos: [todo('review', 'Read the saved work state', 'pending')],
        plan: {
          id: 'saved-plan',
          runId: null,
          title: 'Existing plan',
          content: 'Report the saved state without modifying it.',
          steps: [{ id: 'review', title: 'Review', status: 'pending' }],
          status: 'approved',
          review: 'approved',
          feedback: null,
          updatedAt: 1,
        },
      });
      f.faux.setResponses([
        (context) => {
          contexts.push(context);
          return call('read_file', { path: 'large.txt', maxLines: 500 });
        },
        (context) => {
          contexts.push(context);
          return fauxAssistantMessage('Reported the existing work state.');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Read the context-only file and report the existing plan.',
        mode: 'send',
        requestId: 'context-only-executor',
      });
      await idle(f);
      expect(f.runtime.getSnapshot(f.session.id).runs.at(-1)?.status).toBe('completed');
      expect(contexts).toHaveLength(2);
      for (const context of contexts) {
        const names = definitions(context).map(({ name }) => name);
        expect(names).not.toContain('read_tool_result');
        expect(names).not.toContain('update_plan');
        expect(names).not.toContain('update_plan_steps');
        expect(names).not.toContain('update_todos');
      }
      const projected = JSON.stringify(contexts[1]?.messages);
      expect(projected).toContain('Existing plan');
      expect(projected).toContain('Tool result shortened');
      expect(projected).not.toContain('read_tool_result(');
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('loads the retained-result reader in the same request while preserving original SDK and stored text', async () => {
    const f = await fixture(true);
    const contexts: TranscriptContext[] = [];
    const source = 'Observed source evidence with an unchanged retained body.\n'.repeat(600);
    const originalBodies: string[] = [];
    const project = f.work.context.project.bind(f.work.context);
    const spy = vi.spyOn(f.work.context, 'project').mockImplementation(async (input) => {
      for (const message of input.messages)
        if (message.role === 'toolResult' && message.toolName === 'read_file')
          for (const part of message.content)
            if (part.type === 'text') originalBodies.push(part.text);
      return await project(input);
    });
    try {
      f.faux.models[0].contextWindow = 32_768;
      f.faux.models[0].maxTokens = 512;
      await writeFile(join(f.root, 'large.txt'), source);
      f.faux.setResponses([
        (context) => {
          contexts.push(context);
          expect(definitions(context).map(({ name }) => name)).not.toContain('read_tool_result');
          return call('read_file', { path: 'large.txt', maxLines: 500 }, 'provider-read');
        },
        (context) => {
          contexts.push(context);
          const tool = f.runtime
            .getSnapshot(f.session.id)
            .tools.find(({ name }) => name === 'read_file');
          if (tool === undefined) throw new Error('missing retained tool');
          expect(tool.id).not.toBe('provider-read');
          expect(definitions(context).map(({ name }) => name)).toContain('read_tool_result');
          expect(JSON.stringify(context.messages)).toContain(tool.id);
          expect(JSON.stringify(context.messages)).not.toContain('search_session_history(query)');
          return call(
            'read_tool_result',
            { toolCallId: tool.id, offset: 4096, maxCharacters: 6000 },
            'provider-page',
          );
        },
        (context) => {
          contexts.push(context);
          expect(JSON.stringify(context.messages)).toContain('nextOffset:');
          return fauxAssistantMessage('Read the saved source without repeating the original tool.');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Read the large file and inspect its saved middle section.',
        mode: 'send',
        requestId: 'retained-reader',
      });
      await idle(f);
      const snapshot = f.runtime.getSnapshot(f.session.id);
      expect(snapshot.runs.at(-1)?.status, JSON.stringify(f.errors)).toBe('completed');
      expect(contexts).toHaveLength(3);
      expect(snapshot.tools.map(({ name, status }) => ({ name, status }))).toEqual([
        { name: 'read_file', status: 'completed' },
        { name: 'read_tool_result', status: 'completed' },
      ]);
      expect(originalBodies).toHaveLength(2);
      expect(originalBodies[0]).toBe(originalBodies[1]);
      expect(originalBodies[0]?.length).toBeGreaterThan(8192);
      expect(originalBodies[0]).not.toContain('Tool result shortened');
      expect(snapshot.tools[0]?.result).toBe(originalBodies[0]);
      const events = f.store.readEvents(f.session.id, 0, 1000);
      const loads = events.filter(({ type }) => type === 'run.tools_loaded');
      expect(loads).toHaveLength(1);
      expect(loads[0]?.data['names']).toContain('read_tool_result');
      const prepared = events.filter(({ type }) => type === 'context.prepared');
      expect(prepared.map(({ data }) => data['capabilityRevision'])).toEqual([1, 2, 2]);
      expect(loads[0]?.seq).toBeLessThan(prepared[1]?.seq ?? 0);
      const lastContext = contexts.at(-1);
      if (lastContext === undefined) throw new Error('missing provider context');
      const expected = estimateContextUsage(
        [],
        '',
        f.faux.models[0].contextWindow,
        f.faux.models[0].maxTokens,
        definitions(lastContext),
      );
      expect(f.work.snapshot(f.session.id).state.usage?.categories.tools).toBe(
        expected.categories.tools,
      );
      expect(f.errors).toEqual([]);
    } finally {
      spy.mockRestore();
      await f.close();
    }
  });
});
