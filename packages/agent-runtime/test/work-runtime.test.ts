import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import {
  fixture,
  observe,
  idle,
  call,
  questionArgs,
  answerText,
  summary,
  todo,
  pendingQuestion,
  sendTurn,
  gate,
  withinDeadline,
} from './support/work-fixture.js';

describe('M3 durable session work through real Pi tools', () => {
  it('rejects stale branch work commands even when both branches have the same revision', async () => {
    const f = await fixture();
    try {
      await f.work.patch(f.session.id, {
        expectedBranchId: f.session.activeBranchId,
        revision: 0,
      });
      const saved = await f.work.createCheckpoint(f.session.id, {
        expectedBranchId: f.session.activeBranchId,
        label: 'Original branch',
      });
      const checkpoint = saved.checkpoints[0];
      if (!checkpoint) throw new Error('Missing checkpoint');
      const stale = { expectedBranchId: saved.state.branchId, revision: saved.state.revision };
      const restored = await f.work.restore(f.session.id, checkpoint.id, stale);
      expect(restored.state.revision).toBe(stale.revision);
      expect(restored.state.branchId).not.toBe(stale.expectedBranchId);
      const before = f.runtime.getSnapshot(f.session.id);
      const commands = [
        () => f.work.patch(f.session.id, { ...stale }),
        () => f.work.reset(f.session.id, stale),
        () => f.work.compact(f.session.id, stale),
        () => f.work.restore(f.session.id, checkpoint.id, stale),
        () =>
          f.work.createCheckpoint(f.session.id, {
            expectedBranchId: stale.expectedBranchId,
            label: 'Stale original branch',
          }),
      ];
      for (const command of commands)
        await expect(command()).rejects.toMatchObject({ code: 'WORK_CONFLICT' });
      expect(() => f.work.snapshot(f.session.id, stale.expectedBranchId)).toThrow(
        expect.objectContaining({ code: 'WORK_CONFLICT' }),
      );
      expect(f.work.snapshot(f.session.id, restored.state.branchId)).toEqual(restored);
      expect(f.runtime.getSnapshot(f.session.id)).toEqual(before);
      expect(f.releases()).toBe(0);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('cancels every manual summary queued before its serialized command starts', async () => {
    const f = await fixture();
    try {
      const input = { expectedBranchId: f.session.activeBranchId, revision: 0 };
      const compacted = [
        f.work.compact(f.session.id, input),
        f.work.compact(f.session.id, input),
      ].map(async (pending): Promise<unknown> => {
        try {
          return await pending;
        } catch (error) {
          return error;
        }
      });
      await withinDeadline(f.runtime.cancel(f.session.id), 'Queued summary blocked cancellation');
      for (const result of await Promise.all(compacted))
        expect(result).toMatchObject({ name: 'AbortError' });
      expect(f.work.snapshot(f.session.id).state.revision).toBe(0);
      expect(f.releases()).toBe(0);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('asks without a workspace, accepts free text once and resumes with the exact tool answer', async () => {
    const f = await fixture();
    const contexts: TranscriptContext[] = [];
    try {
      f.faux.setResponses([
        (context) => {
          expect(
            context.messages.flatMap((message) =>
              message.role === 'system' ? (message.toolsAdded ?? []).map(({ name }) => name) : [],
            ),
          ).toEqual([
            'web_fetch',
            'ask_user',
            'update_plan',
            'update_plan_steps',
            'update_todos',
            'search_session_history',
            'restore_context_checkpoint',
            'reset_working_state',
          ]);
          return call('ask_user', questionArgs('Which format?', ['Markdown', 'Text']));
        },
        (context) => {
          contexts.push(context);
          return fauxAssistantMessage('Will use JSON');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Prepare a report',
        mode: 'send',
        requestId: 'ask',
      });
      await observe(f.runtime, f.session.id, () =>
        f.work.snapshot(f.session.id).state.questions.some(({ status }) => status === 'pending'),
      );
      const question = pendingQuestion(f);
      const foreign = f.runtime.createSession({
        title: 'Other',
        providerId: f.faux.provider.id,
        modelId: f.faux.models[0].id,
        thinkingLevel: 'off',
        workspaceId: null,
        approvalMode: 'ask',
      });
      await expect(
        f.work.answer(foreign.id, question.id, answerText('Bad session')),
      ).rejects.toMatchObject({
        code: 'QUESTION_CONFLICT',
      });
      await f.work.answer(f.session.id, question.id, answerText('JSON please'));
      await expect(
        f.work.answer(f.session.id, question.id, answerText('Second answer')),
      ).rejects.toMatchObject({ code: 'QUESTION_CONFLICT' });
      await idle(f);
      expect(f.work.snapshot(f.session.id).state.questions[0]).toMatchObject({
        status: 'answered',
        answers: answerText('JSON please'),
      });
      expect(contexts[0]?.messages.find((message) => message.role === 'toolResult')).toMatchObject({
        toolName: 'ask_user',
        isError: false,
        content: [{ type: 'text', text: JSON.stringify({ answers: answerText('JSON please') }) }],
      });
      expect(f.runtime.getSnapshot(f.session.id).runs[0]?.status).toBe('completed');
      expect(f.runtime.getSnapshot(f.session.id).tools[0]?.status).toBe('completed');
      expect(
        f.store.readEvents(f.session.id, 0, 1000).some(({ type }) => type === 'context.prepared'),
      ).toBe(true);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it.each(['answer-cancel', 'stop'] as const)(
    'ends pending questions on %s and never reuses their answer',
    async (action) => {
      const f = await fixture();
      try {
        f.faux.setResponses([
          call('ask_user', questionArgs('Proceed?')),
          fauxAssistantMessage('Question cancelled'),
        ]);
        await f.runtime.send(f.session.id, {
          text: 'Ask first',
          mode: 'send',
          requestId: 'cancel-question',
        });
        await observe(f.runtime, f.session.id, () =>
          f.work.snapshot(f.session.id).state.questions.some(({ status }) => status === 'pending'),
        );
        const question = pendingQuestion(f);
        if (action === 'stop') await f.runtime.cancel(f.session.id);
        else await f.work.answer(f.session.id, question.id, null);
        await idle(f);
        expect(f.work.snapshot(f.session.id).state.questions[0]).toMatchObject({
          status: 'cancelled',
          answers: null,
        });
        expect(f.runtime.getSnapshot(f.session.id).runs[0]?.status).toBe(
          action === 'stop' ? 'cancelled' : 'completed',
        );
        await expect(
          f.work.answer(f.session.id, question.id, answerText('Too late')),
        ).rejects.toMatchObject({
          code: 'QUESTION_CONFLICT',
        });
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it('waits for plan feedback, then approves and executes in the same Run with task evidence', async () => {
    const f = await fixture();
    try {
      const steps = [{ id: 'analysis', title: 'Analyze inputs', status: 'pending' }];
      f.faux.setResponses([
        call('update_plan', { title: 'Report', content: 'Analyze input', steps }),
        call('update_plan', {
          title: 'Revised report',
          content: 'Analyze input and explain assumptions',
          steps,
        }),
        call('update_todos', {
          todos: [
            {
              ...todo('analysis', 'Analyze inputs', 'completed'),
              planStepId: 'analysis',
              completionNote: 'Compared the supplied facts and recorded the assumptions.',
            },
          ],
        }),
        call('update_plan_steps', { steps: [{ id: 'analysis', status: 'completed' }] }),
        fauxAssistantMessage('Report complete'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Plan a report',
        mode: 'send',
        requestId: 'plan-review',
      });
      await observe(
        f.runtime,
        f.session.id,
        () => f.work.snapshot(f.session.id).state.plan?.review === 'pending',
      );
      let state = f.work.snapshot(f.session.id).state;
      const runId = f.runtime.getSnapshot(f.session.id).session.activeRunId;
      if (!state.plan) throw new Error('Missing plan');
      expect(state.plan.review).toBe('pending');
      await f.work.reviewPlan(f.session.id, state.plan.id, {
        expectedBranchId: state.branchId,
        revision: state.revision,
        decision: 'feedback',
        feedback: 'Explain assumptions',
      });
      await observe(
        f.runtime,
        f.session.id,
        () =>
          f.work.snapshot(f.session.id).state.plan?.title === 'Revised report' &&
          f.work.snapshot(f.session.id).state.plan?.review === 'pending',
      );
      state = f.work.snapshot(f.session.id).state;
      if (!state.plan) throw new Error('Missing revised plan');
      await expect(
        f.work.reviewPlan(f.session.id, state.plan.id, {
          expectedBranchId: state.branchId,
          revision: state.revision - 1,
          decision: 'approve',
          feedback: '',
        }),
      ).rejects.toMatchObject({ code: 'WORK_CONFLICT' });
      await f.work.reviewPlan(f.session.id, state.plan.id, {
        expectedBranchId: state.branchId,
        revision: state.revision,
        decision: 'approve',
        feedback: '',
      });
      await idle(f);
      const done = f.work.snapshot(f.session.id).state;
      expect(done.plan?.review).toBe('approved');
      expect(done.plan).toMatchObject({
        title: 'Revised report',
        status: 'completed',
        review: 'approved',
      });
      expect(done.todos[0]).toMatchObject({ status: 'completed', planStepId: 'analysis' });
      expect(f.runtime.getSnapshot(f.session.id).runs).toHaveLength(1);
      expect(f.runtime.getSnapshot(f.session.id).runs[0]?.id).toBe(runId);
      expect(
        f.runtime.getSnapshot(f.session.id).tools.every(({ status }) => status === 'completed'),
      ).toBe(true);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('compares checkpoint state and restores a new branch while preserving later history and work', async () => {
    const f = await fixture();
    try {
      await sendTurn(f, 'First request', 'First answer');
      let state = f.work.snapshot(f.session.id).state;
      f.work.save(f.session.id, {
        ...state,
        plan: {
          id: 'original',
          runId: null,
          title: 'Original plan',
          content: 'First scope',
          steps: [],
          status: 'draft',
          review: null,
          feedback: null,
          updatedAt: 1,
        },
        todos: [todo('first', 'First task', 'pending')],
      });
      const saved = await f.work.createCheckpoint(f.session.id, {
        expectedBranchId: state.branchId,
        label: 'Before expansion',
      });
      const checkpoint = saved.checkpoints[0];
      if (!checkpoint) throw new Error('Missing checkpoint');
      await sendTurn(f, 'Later request', 'Later answer');
      state = f.work.snapshot(f.session.id).state;
      f.work.save(f.session.id, {
        ...state,

        plan: {
          id: 'later',
          runId: null,
          title: 'Later plan',
          content: 'Expanded scope',
          steps: [],
          status: 'draft',
          review: null,
          feedback: null,
          updatedAt: 2,
        },
        todos: [todo('later', 'Later task', 'completed')],
      });
      const expanded = f.work.snapshot(f.session.id);
      const originalBranch = f.runtime.getSnapshot(f.session.id).session.activeBranchId;
      expect(expanded.state.plan?.title).not.toBe(checkpoint.state.plan?.title);
      expect(f.runtime.getSnapshot(f.session.id).messages.length).toBeGreaterThan(
        checkpoint.messageIds.length,
      );
      const restored = await f.work.restore(f.session.id, checkpoint.id, {
        expectedBranchId: expanded.state.branchId,
        revision: expanded.state.revision,
      });
      const branch = f.runtime.getSnapshot(f.session.id);
      expect(branch.session.activeBranchId).not.toBe(originalBranch);
      expect(branch.messages.map(({ id }) => id)).toEqual(checkpoint.messageIds);
      expect(branch.branches).toHaveLength(2);
      expect(restored.state.plan).toEqual(checkpoint.state.plan);
      expect(restored.state.todos).toEqual(checkpoint.state.todos);
      await f.runtime.selectBranch(f.session.id, originalBranch);
      expect(f.runtime.getSnapshot(f.session.id).messages.map(({ text }) => text)).toEqual([
        'First request',
        'First answer',
        'Later request',
        'Later answer',
      ]);
      expect(f.work.snapshot(f.session.id).state).toEqual(expanded.state);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('resets stopped work and queued input while preserving history and excluding it from the next model request', async () => {
    const f = await fixture();
    const contexts: TranscriptContext[] = [];
    try {
      f.faux.setResponses([call('ask_user', questionArgs('Choose next step'))]);
      await f.runtime.send(f.session.id, {
        text: 'Old context',
        mode: 'send',
        requestId: 'before-reset',
      });
      await observe(f.runtime, f.session.id, () =>
        f.work.snapshot(f.session.id).state.questions.some(({ status }) => status === 'pending'),
      );
      await f.runtime.send(f.session.id, {
        text: 'Do not replay this',
        mode: 'follow-up',
        requestId: 'queued-before-reset',
      });
      await f.runtime.cancel(f.session.id);
      const oldMessages = f.runtime.getSnapshot(f.session.id).messages;
      const before = f.work.snapshot(f.session.id).state;
      await expect(
        f.work.reset(f.session.id, {
          expectedBranchId: before.branchId,
          revision: before.revision - 1,
        }),
      ).rejects.toMatchObject({ code: 'WORK_CONFLICT' });
      expect(f.runtime.getSnapshot(f.session.id).queue).toHaveLength(1);
      const reset = await f.work.reset(f.session.id, {
        expectedBranchId: before.branchId,
        revision: before.revision,
      });
      expect(reset.state).toMatchObject({
        plan: null,
        todos: [],
        questions: [],
        compaction: null,
        contextStartAfterMessageId: oldMessages.at(-1)?.id,
      });
      expect(f.runtime.getSnapshot(f.session.id).queue).toEqual([]);
      expect(f.runtime.getSnapshot(f.session.id).messages).toEqual(oldMessages);
      f.faux.setResponses([
        (context) => {
          contexts.push(context);
          return fauxAssistantMessage('Fresh reply');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'After reset',
        mode: 'send',
        requestId: 'after-reset',
      });
      await idle(f);
      expect(
        contexts[0]?.messages.filter(({ role }) => role === 'user').map(({ content }) => content),
      ).toEqual(['After reset']);
      expect(contexts[0]?.messages.some(({ role }) => role === 'toolResult')).toBe(false);
      const prepared = f.store
        .readEvents(f.session.id, 0, 1000)
        .filter(({ type }) => type === 'context.prepared')
        .at(-1);
      const newestUser = f.runtime
        .getSnapshot(f.session.id)
        .messages.find((message) => message.text === 'After reset');
      expect(prepared?.data['messageIds']).toEqual([newestUser?.id]);
      expect(prepared?.data['attachmentIds']).toEqual([]);
      expect(f.runtime.getSnapshot(f.session.id).messages.slice(0, oldMessages.length)).toEqual(
        oldMessages,
      );
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('reloads project rules for the next run and retains each earlier rule snapshot', async () => {
    const f = await fixture(true);
    const contexts: TranscriptContext[] = [];
    try {
      await writeFile(join(f.root, 'AGENTS.md'), 'Use concise reports.');
      f.faux.setResponses([
        (context) => {
          contexts.push(context);
          return fauxAssistantMessage('First report');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'First report',
        mode: 'send',
        requestId: 'first-rule-run',
      });
      await idle(f);
      const firstRules = f.work.snapshot(f.session.id).state.rules;
      await writeFile(join(f.root, 'AGENTS.md'), 'Use detailed reports.');
      f.faux.setResponses([
        (context) => {
          contexts.push(context);
          return fauxAssistantMessage('Second report');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Second report',
        mode: 'send',
        requestId: 'second-rule-run',
      });
      await idle(f);
      const secondRules = f.work.snapshot(f.session.id).state.rules;
      expect(firstRules[0]?.content).toBe('Use concise reports.');
      expect(secondRules[0]?.content).toBe('Use detailed reports.');
      expect(secondRules[0]?.hash).not.toBe(firstRules[0]?.hash);
      expect(contexts[0]?.messages.find(({ role }) => role === 'system')?.content).toContain(
        'Use concise reports.',
      );
      expect(contexts[1]?.messages.find(({ role }) => role === 'system')?.content).toContain(
        'Use detailed reports.',
      );
      const events = f.store
        .readEvents(f.session.id, 0, 1000)
        .filter(({ type }) => type === 'work.updated');
      expect(JSON.stringify(events)).toContain('Use concise reports.');
      expect(JSON.stringify(events)).toContain('Use detailed reports.');
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('uses frozen reference content after its source disappears and reloads surviving ancestor rules', async () => {
    const f = await fixture(true);
    const contexts: TranscriptContext[] = [];
    try {
      await mkdir(join(f.root, 'src'));
      await writeFile(join(f.root, 'src', 'AGENTS.md'), 'Original source rule');
      await writeFile(join(f.root, 'src', 'input.txt'), 'Frozen source text');
      f.store.putAttachment({
        attachment: {
          id: 'reference',
          name: 'input.txt',
          kind: 'reference',
          mediaType: 'text/plain',
          byteLength: 18,
          preview: 'Frozen source text',
          sourcePath: 'src/input.txt',
          workspaceId: 'workspace',
          createdAt: 1,
        },
        text: 'Frozen source text',
        imageData: null,
      });
      f.faux.setResponses([fauxAssistantMessage('Read the attached source')]);
      await f.runtime.send(f.session.id, {
        text: 'Use the source',
        attachmentIds: ['reference'],
        mode: 'send',
        requestId: 'original-reference',
      });
      await idle(f);
      await rm(join(f.root, 'src', 'input.txt'));
      await writeFile(join(f.root, 'src', 'AGENTS.md'), 'Updated source rule');
      f.faux.setResponses([
        (context) => {
          contexts.push(context);
          return fauxAssistantMessage('Continue from frozen source');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Continue',
        mode: 'send',
        requestId: 'deleted-source',
      });
      await idle(f);
      expect(f.work.snapshot(f.session.id).state.rules[0]?.content).toBe('Updated source rule');
      expect(JSON.stringify(contexts[0]?.messages.filter(({ role }) => role === 'user'))).toContain(
        'Frozen source text',
      );
      expect(contexts[0]?.messages.find(({ role }) => role === 'system')?.content).toContain(
        'Updated source rule',
      );
      await rm(join(f.root, 'src'), { recursive: true });
      await sendTurn(f, 'Continue after directory removal', 'Frozen source is still available');
      expect(f.work.snapshot(f.session.id).state.rules).toEqual([]);
      expect(f.store.getAttachment('reference')?.text).toBe('Frozen source text');
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it.each([false, true])(
    'automatically summarizes twice with existing anchors, after reset: %s',
    async (afterReset) => {
      const f = await fixture();
      const contexts: TranscriptContext[] = [];
      try {
        if (afterReset) {
          await sendTurn(f, 'History before reset', 'Prior work');
          const state = f.work.snapshot(f.session.id).state;
          await f.work.reset(f.session.id, {
            expectedBranchId: state.branchId,
            revision: state.revision,
          });
        }
        for (let index = 1; index <= 3; index += 1)
          await sendTurn(
            f,
            `Input ${index}: ${'x'.repeat(2500)}`,
            `Answer ${index}: ${'y'.repeat(2500)}`,
          );
        const before = f.runtime.getSnapshot(f.session.id).messages;
        f.faux.models[0].contextWindow = 8000;
        f.faux.models[0].maxTokens = 512;
        f.faux.setResponses([
          (context) => {
            contexts.push(context);
            return fauxAssistantMessage(
              summary('The first task is complete; continue the pending work.'),
            );
          },
          (context) => {
            contexts.push(context);
            return fauxAssistantMessage('Fourth response');
          },
        ]);
        await f.runtime.send(f.session.id, {
          text: `Input 4: ${'z'.repeat(2500)}`,
          mode: 'send',
          requestId: 'automatic-summary',
        });
        await idle(f);
        expect(f.work.snapshot(f.session.id).state.compaction).toMatchObject({
          reason: 'automatic',
          strategy: 'model',
        });
        expect(contexts).toHaveLength(2);
        expect(contexts[1]?.messages.find(({ role }) => role === 'system')?.content).toContain(
          'The first task is complete; continue the pending work.',
        );
        expect(f.runtime.getSnapshot(f.session.id).messages.slice(0, before.length)).toEqual(
          before,
        );
        expect(f.runtime.getSnapshot(f.session.id).runs.at(-1)?.status).toBe('completed');
        f.faux.setResponses([
          fauxAssistantMessage(
            summary('The first two tasks are complete; preserve the remaining work.'),
          ),
          (context) => {
            contexts.push(context);
            return fauxAssistantMessage('Fifth response');
          },
        ]);
        await f.runtime.send(f.session.id, {
          text: `Input 5: ${'w'.repeat(8000)}`,
          mode: 'send',
          requestId: 'second-auto-summary',
        });
        await idle(f);
        expect(f.work.snapshot(f.session.id).state.compaction).toMatchObject({
          reason: 'automatic',
          strategy: 'model',
        });
        expect(contexts.at(-1)?.messages.find(({ role }) => role === 'system')?.content).toContain(
          'The first two tasks are complete; preserve the remaining work.',
        );
        expect(f.runtime.getSnapshot(f.session.id).messages.slice(0, before.length)).toEqual(
          before,
        );
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it('summarizes complete turns and falls back conservatively while retaining raw history when a later model fails', async () => {
    const f = await fixture();
    const summaryContexts: TranscriptContext[] = [];
    try {
      await sendTurn(f, 'Turn one', 'Answer one');
      await sendTurn(f, 'Turn two', 'Answer two');
      await sendTurn(f, 'Turn three', 'Answer three');
      const history = f.runtime.getSnapshot(f.session.id).messages;
      f.faux.setResponses([
        (context) => {
          summaryContexts.push(context);
          return fauxAssistantMessage(summary('Completed turn one; keep the agreed goal.'));
        },
      ]);
      let state = f.work.snapshot(f.session.id).state;
      const compacted = await f.work.compact(f.session.id, {
        expectedBranchId: state.branchId,
        revision: state.revision,
      });
      expect(compacted.state.compaction).toMatchObject({
        throughMessageId: history[1]?.id,
        reason: 'manual',
      });
      expect(compacted.state.compaction?.summary).toContain(
        'Completed turn one; keep the agreed goal.',
      );
      expect(summaryContexts[0]?.messages.find(({ role }) => role === 'user')?.content).toContain(
        'Turn one',
      );
      expect(
        summaryContexts[0]?.messages.find(({ role }) => role === 'user')?.content,
      ).not.toContain('Turn two');
      expect(f.runtime.getSnapshot(f.session.id).messages).toEqual(history);
      f.faux.setResponses([
        (context) => {
          const messages = context.messages
            .filter(({ role }) => role === 'user')
            .map(({ content }) => content);
          expect(messages).toEqual(['Turn two', 'Turn three', 'Turn four']);
          expect(context.messages.find(({ role }) => role === 'system')?.content).toContain(
            'Completed turn one; keep the agreed goal.',
          );
          return fauxAssistantMessage('Answer four');
        },
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Turn four',
        mode: 'send',
        requestId: 'turn-four',
      });
      await idle(f);
      state = f.work.snapshot(f.session.id).state;
      const beforeFailure = f.runtime.getSnapshot(f.session.id).messages;
      f.faux.setResponses([
        fauxAssistantMessage('', {
          stopReason: 'error',
          errorMessage: 'Synthetic summary failure',
        }),
      ]);
      const fallback = await f.work.compact(f.session.id, {
        expectedBranchId: state.branchId,
        revision: state.revision,
      });
      expect(fallback.state.compaction?.strategy).toBe('fallback');
      expect(fallback.state.compaction?.parentId).toBe(compacted.state.compaction?.id);
      expect(f.runtime.getSnapshot(f.session.id).messages).toEqual(beforeFailure);
      expect(f.releases()).toBe(6);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
  it('cancels a gated manual summary before its response is released and preserves the saved summary', async () => {
    const f = await fixture();
    const entered = gate();
    const response = gate();
    let responseReleased = false;
    let providerAborted = false;
    try {
      for (let index = 1; index <= 3; index += 1)
        await sendTurn(f, `Before ${index}`, `Result ${index}`);
      f.faux.setResponses([fauxAssistantMessage(summary('Saved first-turn summary'))]);
      const initial = f.work.snapshot(f.session.id).state;
      await f.work.compact(f.session.id, {
        expectedBranchId: initial.branchId,
        revision: initial.revision,
      });
      await sendTurn(f, 'Before 4', 'Result 4');
      const before = f.work.snapshot(f.session.id).state;
      const messages = f.runtime.getSnapshot(f.session.id).messages;
      f.faux.setResponses([
        async (_context, options) => {
          const signal = options?.signal;
          if (!signal) throw new Error('Summary did not provide a cancellation signal');
          let rejectAbort = (_reason: unknown): void => {
            throw new Error('Abort handler not initialized');
          };
          const aborted = new Promise<never>((_resolve, reject) => {
            rejectAbort = reject;
          });
          const abort = (): void => {
            providerAborted = true;
            rejectAbort(new DOMException('Cancelled synthetic summary', 'AbortError'));
          };
          signal.addEventListener('abort', abort, { once: true });
          entered.release();
          try {
            await Promise.race([response.promise, aborted]);
            return fauxAssistantMessage('This gated response must not replace the summary');
          } finally {
            signal.removeEventListener('abort', abort);
          }
        },
      ]);
      const compacted = (async (): Promise<unknown> => {
        try {
          await f.work.compact(f.session.id, {
            expectedBranchId: before.branchId,
            revision: before.revision,
          });
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      await withinDeadline(entered.promise, 'Summary did not reach the synthetic provider gate');
      await withinDeadline(
        f.runtime.cancel(f.session.id),
        'Cancelling summary waited for its gated response',
      );
      expect(responseReleased).toBe(false);
      expect(providerAborted).toBe(true);
      expect(await compacted).toMatchObject({ name: 'AbortError' });
      expect(f.work.snapshot(f.session.id).state.compaction).toEqual(before.compaction);
      expect(f.runtime.getSnapshot(f.session.id).messages).toEqual(messages);
      expect(f.errors).toEqual([]);
    } finally {
      responseReleased = true;
      response.release();
      await f.close();
    }
  });
});
