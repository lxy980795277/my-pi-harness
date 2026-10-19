import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fauxAssistantMessage, type Message } from '@earendil-works/pi-ai';
import { ContextSummarySchema, type ContextSummary, type WorkState } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { fallbackSummary, renderSummary } from '../src/context/summary.js';
import { fixture, idle, call, sendTurn, todo, observe } from './support/work-fixture.js';

function largeSummary(): ContextSummary {
  const entries = Array.from({ length: 20 }, (_, index) =>
    `Fact ${index}: ${'long fact "quoted"\n'.repeat(200)}`.slice(0, 4000),
  );
  return {
    objective: 'Continue the task.',
    constraints: entries,
    decisions: entries,
    completed: entries,
    pending: entries,
    blockers: entries,
    nextAction: 'Inspect the failed evidence.',
  };
}

function expectSummaryFits(summary: ContextSummary): void {
  expect(Value.Check(ContextSummarySchema, summary)).toBe(true);
  expect(JSON.stringify(summary).length).toBeLessThanOrEqual(24_000);
  expect(renderSummary(summary).length).toBeLessThanOrEqual(30_000);
}

describe('M3 review regression cases', () => {
  it('rejects a replacement plan that breaks task links before saving or waiting, while retaining compatible steps', async () => {
    const f = await fixture();
    let unsubscribe = (): void => undefined;
    try {
      const linkedStep = { id: 'linked-step', title: 'Analyze inputs', status: 'pending' as const };
      const addedStep = { id: 'added-step', title: 'Explain results', status: 'pending' as const };
      const linkedTask = {
        ...todo('analysis', 'Analyze inputs', 'pending'),
        planStepId: linkedStep.id,
      };
      const original = f.work.snapshot(f.session.id).state;
      f.work.save(f.session.id, {
        ...original,
        plan: {
          id: 'original-plan',
          runId: null,
          title: 'Original plan',
          content: 'Analyze the supplied facts.',
          steps: [linkedStep],
          status: 'approved',
          review: 'approved',
          feedback: null,
          updatedAt: 1,
        },
        todos: [linkedTask],
      });
      let beforeRejectedPlan: WorkState | undefined;
      let afterRejectedPlan: WorkState | undefined;
      unsubscribe = f.runtime.subscribe(f.session.id, (event) => {
        if (event.type !== 'tool.requested' && event.type !== 'tool.updated') return;
        const tool = f.runtime.getSnapshot(f.session.id).tools.at(-1);
        if (tool?.name !== 'update_plan' || tool.arguments.title !== 'Broken replacement') return;
        if (event.type === 'tool.requested')
          beforeRejectedPlan = f.work.snapshot(f.session.id).state;
        if (event.type === 'tool.updated' && tool.status === 'failed')
          afterRejectedPlan = f.work.snapshot(f.session.id).state;
      });
      f.faux.setResponses([
        call('update_plan', {
          title: 'Broken replacement',
          content: 'Explain results without the linked analysis step.',
          steps: [addedStep],
        }),
        call('update_plan', {
          title: 'Compatible replacement',
          content: 'Preserve analysis and add an explanation.',
          steps: [linkedStep, addedStep],
        }),
        call('update_plan_steps', { steps: [{ id: addedStep.id, status: 'completed' }] }),
        fauxAssistantMessage('The compatible plan was reviewed and its steps updated.'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Revise the plan while preserving task links.',
        mode: 'send',
        requestId: 'replace-linked-plan',
      });
      await observe(
        f.runtime,
        f.session.id,
        () => f.work.snapshot(f.session.id).state.plan?.review === 'pending',
      );
      expect(beforeRejectedPlan).toBeDefined();
      expect(afterRejectedPlan).toEqual(beforeRejectedPlan);
      const failed = f.runtime.getSnapshot(f.session.id).tools[0];
      expect(failed).toMatchObject({ name: 'update_plan', status: 'failed' });
      expect(failed?.result).toContain('请先更新或清理任务关联');
      const pending = f.work.snapshot(f.session.id).state;
      expect(pending.plan).toMatchObject({
        title: 'Compatible replacement',
        steps: [linkedStep, addedStep],
        review: 'pending',
      });
      expect(pending.todos).toEqual([linkedTask]);
      if (pending.plan === null) throw new Error('Missing compatible plan');
      await f.work.reviewPlan(f.session.id, pending.plan.id, {
        expectedBranchId: pending.branchId,
        revision: pending.revision,
        decision: 'approve',
        feedback: '',
      });
      await idle(f);
      const final = f.work.snapshot(f.session.id).state;
      expect(final.plan?.steps).toEqual([linkedStep, { ...addedStep, status: 'completed' }]);
      expect(final.todos).toEqual([linkedTask]);
      expect(f.runtime.getSnapshot(f.session.id).runs[0]?.status).toBe('completed');
      expect(f.errors).toEqual([]);
    } finally {
      unsubscribe();
      await f.close();
    }
  });

  it('bounds consecutive fallback summaries globally despite large prior facts and twenty long failures', async () => {
    const f = await fixture();
    try {
      const failed: Message[] = Array.from({ length: 20 }, (_, index) => ({
        role: 'toolResult',
        toolName: 'read_file',
        toolCallId: `failed-${index}`,
        isError: true,
        content: [
          { type: 'text', text: `Failure ${index}: ${'error detail "quoted"\n'.repeat(300)}` },
        ],
        timestamp: index,
      }));
      const first = fallbackSummary(failed, largeSummary(), f.work.snapshot(f.session.id).state);
      expectSummaryFits(first);
      expectSummaryFits(fallbackSummary(failed, first, f.work.snapshot(f.session.id).state));
      for (let index = 1; index <= 5; index += 1)
        await sendTurn(f, `Long historical task ${index}`, `Observed answer ${index}`);
      const snapshot = f.runtime.getSnapshot(f.session.id);
      const anchor = snapshot.messages[1]?.id;
      if (!anchor) throw new Error('Missing source anchor');
      const state = f.work.snapshot(f.session.id).state;
      f.work.save(f.session.id, {
        ...state,
        compaction: {
          id: 'large-seed',
          parentId: null,
          throughMessageId: anchor,
          structured: largeSummary(),
          summary: 'Earlier task facts are retained.',
          strategy: 'fallback',
          beforeTokens: 1000,
          afterTokens: 500,
          sourceMessages: 2,
          runId: null,
          createdAt: 1,
          reason: 'manual',
        },
      });
      let current = f.work.snapshot(f.session.id).state;
      const compacted = await f.work.compact(f.session.id, {
        expectedBranchId: current.branchId,
        revision: current.revision,
      });
      expect(compacted.state.compaction?.strategy).toBe('fallback');
      if (!compacted.state.compaction) throw new Error('Missing bounded fallback');
      expectSummaryFits(compacted.state.compaction.structured);
      await sendTurn(f, 'One later task', 'A later observation');
      f.faux.setResponses([fauxAssistantMessage('invalid summary JSON')]);
      current = f.work.snapshot(f.session.id).state;
      const repeated = await f.work.compact(f.session.id, {
        expectedBranchId: current.branchId,
        revision: current.revision,
      });
      expect(repeated.state.compaction?.strategy).toBe('fallback');
      if (!repeated.state.compaction) throw new Error('Missing second fallback');
      expectSummaryFits(repeated.state.compaction.structured);
      expect(repeated.state.compaction.parentId).toBe(compacted.state.compaction.id);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('preserves unchanged completion evidence across new Runs and inherited branches while rejecting new stale evidence', async () => {
    const f = await fixture(true);
    try {
      await writeFile(join(f.root, 'evidence.txt'), 'inherited-tool-canary');
      f.faux.setResponses([
        call('read_file', { path: 'evidence.txt' }),
        fauxAssistantMessage('Observed the evidence'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Read the input',
        mode: 'send',
        requestId: 'evidence-source',
      });
      await idle(f);
      const tool = f.runtime.getSnapshot(f.session.id).tools[0];
      if (!tool) throw new Error('Missing successful tool');
      let state = f.work.snapshot(f.session.id).state;
      const completed = {
        ...todo('done', 'Observed input', 'completed'),
        completionNote: null,
        evidenceToolCallIds: [tool.id],
      };
      await f.work.patch(f.session.id, {
        expectedBranchId: state.branchId,
        revision: state.revision,
        todos: [completed, todo('next', 'Next action', 'pending')],
      });
      const saved = await f.work.createCheckpoint(f.session.id, {
        expectedBranchId: state.branchId,
        label: 'With completion evidence',
      });
      const checkpoint = saved.checkpoints[0];
      if (!checkpoint) throw new Error('Missing snapshot');
      const restored = await f.work.restore(f.session.id, checkpoint.id, {
        expectedBranchId: saved.state.branchId,
        revision: saved.state.revision,
      });
      expect(restored.state.branchId).not.toBe(tool.branchId);
      await f.work.patch(f.session.id, {
        expectedBranchId: restored.state.branchId,
        revision: restored.state.revision,
        todos: [completed, todo('next', 'Edited next action', 'pending')],
      });
      expect(f.work.searchHistory(f.session.id, 'inherited-tool-canary')).toContain(
        'tool:read_file',
      );
      f.faux.setResponses([
        call(
          'update_todos',
          { todos: [completed, todo('next', 'Keep the prior evidence', 'pending')] },
          'preserve',
        ),
        call(
          'update_todos',
          { todos: [completed, { ...completed, id: 'forged-new-completion' }] },
          'reject-old-evidence',
        ),
        fauxAssistantMessage('Kept the observed task and rejected a new unsupported completion'),
      ]);
      await f.runtime.send(f.session.id, {
        text: 'Update next task',
        mode: 'send',
        requestId: 'later-run',
      });
      await idle(f);
      const tools = f.runtime.getSnapshot(f.session.id).tools;
      expect(
        tools.find(({ name, status }) => name === 'update_todos' && status === 'completed'),
      ).toBeDefined();
      expect(
        tools.find(({ name, status }) => name === 'update_todos' && status === 'failed'),
      ).toBeDefined();
      expect(f.work.snapshot(f.session.id).state.todos[0]).toEqual(completed);
      state = f.work.snapshot(f.session.id).state;
      await expect(
        f.work.patch(f.session.id, {
          expectedBranchId: state.branchId,
          revision: state.revision,
          todos: [todo('a', 'First', 'in_progress'), todo('b', 'Second', 'in_progress')],
        }),
      ).rejects.toMatchObject({ code: 'TODO_INVALID' });
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('recovers shortened attachment text only from attachments bound to visible session messages', async () => {
    const f = await fixture();
    try {
      const text = `${'Earlier attachment data.\n'.repeat(1200)}attachment-tail-canary`;
      f.store.putAttachment({
        attachment: {
          id: 'attached-text',
          name: 'input.txt',
          mediaType: 'text/plain',
          kind: 'text',
          byteLength: text.length,
          preview: 'Earlier attachment',
          sourcePath: null,
          createdAt: 1,
        },
        text,
        imageData: null,
      });
      f.store.putAttachment({
        attachment: {
          id: 'unbound-text',
          name: 'private.txt',
          mediaType: 'text/plain',
          kind: 'text',
          byteLength: 20,
          preview: 'Other session only',
          sourcePath: null,
          createdAt: 1,
        },
        text: 'unbound-secret-canary',
        imageData: null,
      });
      f.faux.setResponses([fauxAssistantMessage('Read the attached input')]);
      await f.runtime.send(f.session.id, {
        text: 'Read attached data',
        attachmentIds: ['attached-text'],
        mode: 'send',
        requestId: 'attachment-source',
      });
      await idle(f);
      await sendTurn(f, 'Continue later', 'Continuing');
      expect(f.work.searchHistory(f.session.id, 'attachment-tail-canary')).toContain(
        '"kind":"attachment"',
      );
      expect(f.work.searchHistory(f.session.id, 'unbound-secret-canary')).not.toContain(
        'unbound-secret-canary',
      );
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
