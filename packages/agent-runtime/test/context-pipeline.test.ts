import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import {
  fixture,
  idle,
  call,
  observe,
  pendingQuestion,
  sendTurn,
  summary,
  todo,
} from './support/work-fixture.js';

function system(context: TranscriptContext): string {
  return context.messages
    .filter(({ role }) => role === 'system')
    .map(({ content }) => (typeof content === 'string' ? content : JSON.stringify(content)))
    .join('\n');
}

describe('model-visible M3 context lifecycle', () => {
  it('compacts twice inside one Run while retaining corrected facts, failures, current task and the approved plan', async () => {
    const f = await fixture(true);
    let requests = 0;
    let summaries = 0;
    let sawFallback = false;
    const contexts: TranscriptContext[] = [];
    try {
      await writeFile(
        join(f.root, 'large.txt'),
        'Observed input line with retained source evidence and a bounded model projection.\n'.repeat(
          1200,
        ),
      );
      const initial = f.work.snapshot(f.session.id).state;
      f.work.save(f.session.id, {
        ...initial,
        plan: {
          id: 'approved',
          runId: null,
          title: 'Approved report plan',
          content: 'Read evidence and report Shanghai weather assumptions.',
          steps: [{ id: 'evidence', title: 'Read evidence', status: 'in_progress' }],
          status: 'approved',
          review: 'approved',
          feedback: null,
          updatedAt: 1,
        },
      });
      f.faux.models[0].contextWindow = 12_000;
      f.faux.models[0].maxTokens = 512;
      const response = (context: TranscriptContext) => {
        if (system(context).includes('Produce a JSON object with exactly objective')) {
          summaries += 1;
          const records = JSON.stringify(context.messages.filter(({ role }) => role === 'user'));
          if (summaries === 1) {
            expect(records).toContain('Shanghai');
            expect(records).toContain('missing.txt');
          }
          if (summaries === 2) return fauxAssistantMessage('invalid summary JSON');
          return fauxAssistantMessage(
            JSON.stringify({
              objective: 'Current task: produce the report; corrected city is Shanghai.',
              constraints: ['Approved report plan remains in force.'],
              decisions: ['Shanghai supersedes Beijing.'],
              completed: ['Read observed input.'],
              pending: ['Finish the report.'],
              blockers: ['missing.txt could not be read.'],
              nextAction: 'Continue reading retained evidence.',
            }),
          );
        }
        contexts.push(context);
        requests += 1;
        if (f.work.snapshot(f.session.id).state.compaction?.strategy === 'fallback')
          sawFallback = true;
        if (requests <= 20)
          return call(
            'read_file',
            { path: requests === 1 ? 'missing.txt' : 'large.txt', maxLines: 500 },
            `read-${requests}`,
          );
        return fauxAssistantMessage('Report complete for Shanghai');
      };
      f.faux.setResponses(Array.from({ length: 100 }, () => response));
      await f.runtime.send(f.session.id, {
        text: 'Produce the report. Correction: city=Shanghai replaces Beijing. Keep track of failed evidence reads.',
        mode: 'send',
        requestId: 'one-long-run',
      });
      await idle(f);
      const work = f.work.snapshot(f.session.id);
      const snapshot = f.runtime.getSnapshot(f.session.id);
      expect(
        snapshot.runs.at(-1)?.status,
        JSON.stringify({
          requests,
          summaries,
          run: snapshot.runs.at(-1),
          usage: work.state.usage,
          compactions: work.compactions.map(({ strategy, beforeTokens, afterTokens }) => ({
            strategy,
            beforeTokens,
            afterTokens,
          })),
          tools: snapshot.tools.length,
          errors: f.errors,
        }),
      ).toBe('completed');
      expect(work.compactions.length).toBeGreaterThanOrEqual(2);
      expect(summaries).toBeGreaterThanOrEqual(2);
      expect(sawFallback).toBe(true);
      expect(work.compactions.some(({ strategy }) => strategy === 'fallback')).toBe(true);
      expect(snapshot.runs).toHaveLength(1);
      expect(snapshot.runs[0]?.status).toBe('completed');
      expect(snapshot.messages.filter(({ role }) => role === 'user')).toHaveLength(1);
      const after = contexts.filter((context) => system(context).includes('previousSummary":"##'));
      expect(after.length).toBeGreaterThan(1);
      for (const context of after) {
        expect(system(context)).toContain('Shanghai');
        expect(system(context)).toContain('Approved report plan');
        expect(system(context)).toContain('Current Run user task');
        expect(system(context)).toContain('missing.txt');
      }
      expect(snapshot.tools.filter(({ status }) => status === 'completed')).toHaveLength(19);
      expect(snapshot.tools.some(({ result }) => (result?.length ?? 0) > 16_000)).toBe(true);
      const events = f.store.readEvents(f.session.id, 0, 1000);
      const seen = new Set<string>();
      let expectEstimated = false;
      let providerBaselines = 0;
      for (const event of events) {
        const state = event.data['state'];
        if (
          event.type === 'work.updated' &&
          state &&
          typeof state === 'object' &&
          'compaction' in state
        ) {
          const compaction = state.compaction;
          if (
            compaction &&
            typeof compaction === 'object' &&
            'id' in compaction &&
            typeof compaction.id === 'string' &&
            !seen.has(compaction.id)
          ) {
            seen.add(compaction.id);
            expectEstimated = true;
          }
        }
        if (event.type !== 'context.prepared') continue;
        const usage = event.data['usage'];
        if (expectEstimated) {
          expect(usage).toMatchObject({ source: 'estimated', providerInputTokens: null });
          expectEstimated = false;
        } else if (
          usage &&
          typeof usage === 'object' &&
          'source' in usage &&
          usage.source === 'provider'
        )
          providerBaselines += 1;
      }
      expect(providerBaselines).toBeGreaterThan(0);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  }, 20_000);

  it('validates every structured answer and uses a provider baseline for the next request', async () => {
    const f = await fixture();
    try {
      const questions = [
        {
          id: 'format',
          header: 'Format',
          prompt: 'Choose outputs',
          options: [
            { id: 'md', label: 'Markdown', description: 'Readable report' },
            { id: 'json', label: 'JSON', description: 'Structured data' },
          ],
          multiSelect: true,
          allowCustomInput: false,
        },
        {
          id: 'audience',
          header: 'Audience',
          prompt: 'Who will read it?',
          options: [],
          multiSelect: false,
          allowCustomInput: true,
        },
      ];
      f.faux.setResponses([
        call('ask_user', { questions }),
        fauxAssistantMessage('Answers received'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Prepare output',
        mode: 'send',
        requestId: 'multi-question',
      });
      await observe(f.runtime, f.session.id, () =>
        f.work.snapshot(f.session.id).state.questions.some(({ status }) => status === 'pending'),
      );
      const question = pendingQuestion(f);
      const answers = [
        { questionId: 'format', optionIds: ['md', 'json'], text: '' },
        { questionId: 'audience', optionIds: [], text: 'Engineering team' },
      ];
      await expect(
        f.work.answer(f.session.id, question.id, answers.slice(0, 1)),
      ).rejects.toMatchObject({ code: 'QUESTION_INVALID' });
      await expect(
        f.work.answer(f.session.id, question.id, [
          { ...answers[0], questionId: 'format', optionIds: ['forged'], text: '' },
          answers[1] ?? { questionId: 'audience', optionIds: [], text: 'Team' },
        ]),
      ).rejects.toMatchObject({ code: 'QUESTION_INVALID' });
      await f.work.answer(f.session.id, question.id, answers);
      await idle(f);
      expect(f.work.snapshot(f.session.id).state.questions[0]?.answers).toEqual(answers);
      const usage = f.work.snapshot(f.session.id).state.usage;
      expect(usage?.source).toBe('provider');
      expect(typeof usage?.providerInputTokens).toBe('number');
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('separates task reset, semantic checkpoint selection and branch snapshots, and searches compacted originals', async () => {
    const f = await fixture();
    try {
      for (let index = 1; index <= 3; index += 1)
        await sendTurn(f, `Record ${index} city=Shanghai`, `Answer ${index}`);
      f.faux.setResponses([fauxAssistantMessage(summary('Shanghai is the corrected city.'))]);
      let state = f.work.snapshot(f.session.id).state;
      const first = await f.work.compact(f.session.id, {
        expectedBranchId: state.branchId,
        revision: state.revision,
      });
      await sendTurn(f, 'Later task', 'Later answer');
      f.faux.setResponses([fauxAssistantMessage(summary('Second summary keeps Shanghai.'))]);
      state = f.work.snapshot(f.session.id).state;
      const second = await f.work.compact(f.session.id, {
        expectedBranchId: state.branchId,
        revision: state.revision,
      });
      expect(second.compactions).toHaveLength(2);
      expect(second.state.compaction?.parentId).toBe(first.state.compaction?.id);
      const before = f.runtime.getSnapshot(f.session.id);
      f.work.save(f.session.id, {
        ...second.state,
        todos: [todo('pending', 'Pending work', 'pending')],
      });
      state = f.work.snapshot(f.session.id).state;
      const reset = await f.work.resetTasks(f.session.id, {
        expectedBranchId: state.branchId,
        revision: state.revision,
      });
      expect(reset.state.todos).toEqual([]);
      expect(reset.state.compaction).toEqual(second.state.compaction);
      expect(f.runtime.getSnapshot(f.session.id).messages).toEqual(before.messages);
      if (!first.state.compaction) throw new Error('Missing summary');
      const selected = await f.work.selectCompaction(f.session.id, first.state.compaction.id, {
        expectedBranchId: reset.state.branchId,
        revision: reset.state.revision,
      });
      expect(selected.state.branchId).toBe(before.session.activeBranchId);
      expect(selected.state.contextStartAfterMessageId).toBe(before.messages.at(-1)?.id);
      expect(selected.compactions).toHaveLength(2);
      const contexts: TranscriptContext[] = [];
      f.faux.setResponses([
        (context) => {
          contexts.push(context);
          return call('search_session_history', { query: 'Record 1', limit: 2 });
        },
        fauxAssistantMessage('Found the original'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Find earlier record',
        mode: 'send',
        requestId: 'search-restored',
      });
      await idle(f);
      expect(
        contexts[0]?.messages.filter(({ role }) => role === 'user').map(({ content }) => content),
      ).toEqual(['Find earlier record']);
      expect(f.runtime.getSnapshot(f.session.id).tools.at(-1)?.result).toContain(
        'Record 1 city=Shanghai',
      );
      expect(f.runtime.getSnapshot(f.session.id).branches).toHaveLength(1);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('rejects forged completion evidence and empty input while accepting an attachment-only message', async () => {
    const f = await fixture();
    try {
      await expect(
        f.runtime.send(f.session.id, { text: '  ', mode: 'send', requestId: 'empty' }),
      ).rejects.toMatchObject({ code: 'INPUT_EMPTY' });
      const state = f.work.snapshot(f.session.id).state;
      await expect(
        f.work.patch(f.session.id, {
          expectedBranchId: state.branchId,
          revision: state.revision,
          todos: [
            {
              ...todo('x', 'Claimed side effect', 'completed'),
              evidenceToolCallIds: ['forged'],
              completionNote: null,
            },
          ],
        }),
      ).rejects.toMatchObject({ code: 'TODO_EVIDENCE_INVALID' });
      f.store.putAttachment({
        attachment: {
          id: 'text',
          name: 'input.txt',
          mediaType: 'text/plain',
          kind: 'text',
          byteLength: 4,
          preview: 'data',
          sourcePath: null,
          createdAt: 1,
        },
        text: 'data',
        imageData: null,
      });
      f.faux.setResponses([fauxAssistantMessage('Read attached data')]);
      await f.runtime.send(f.session.id, {
        text: '',
        attachmentIds: ['text'],
        mode: 'send',
        requestId: 'attachment-only',
      });
      await idle(f);
      expect(f.runtime.getSnapshot(f.session.id).runs[0]?.status).toBe('completed');
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
  it('propagates a summary audit write failure without publishing a fallback checkpoint', async () => {
    const f = await fixture();
    try {
      for (let index = 1; index <= 3; index += 1)
        await sendTurn(f, `Audit input ${index}`, `Audit answer ${index}`);
      const state = f.work.snapshot(f.session.id).state;
      const commit = f.work.options.commit.bind(f.work.options);
      f.work.options.commit = (sessionId, events) => {
        if (events.some((event) => event.privateData?.['purpose'] === 'compaction'))
          throw new Error('Synthetic durable audit failure');
        commit(sessionId, events);
      };
      await expect(
        f.work.compact(f.session.id, {
          expectedBranchId: state.branchId,
          revision: state.revision,
        }),
      ).rejects.toThrow('Synthetic durable audit failure');
      expect(f.work.snapshot(f.session.id).compactions).toEqual([]);
      expect(f.work.snapshot(f.session.id).state.compaction).toBeNull();
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
