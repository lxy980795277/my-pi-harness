import {
  LiveMessageDeltaSchema,
  SessionStreamUpdateSchema,
  type SessionStreamUpdate,
} from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import {
  sessionProjection,
  projectionMessage,
} from '../../../tests/fixtures/session-projection.js';
import { createSessionUpdate } from '../src/sessions/stream-update.js';

const patch = (update: SessionStreamUpdate | undefined) => {
  if (!update || update.kind !== 'patch') throw new Error('Expected projection patch');
  expect(Value.Check(SessionStreamUpdateSchema, update)).toBe(true);
  return update;
};

describe('committed session stream batches', () => {
  it('validates a live append target and requires bounded text or thinking data', () => {
    expect(
      Value.Check(LiveMessageDeltaSchema, { runId: 'run', messageId: 'message', text: 'a' }),
    ).toBe(true);
    expect(
      Value.Check(LiveMessageDeltaSchema, { runId: 'run', messageId: 'message', thinking: '' }),
    ).toBe(true);
    for (const value of [
      { runId: 'run', messageId: 'message' },
      { runId: null, messageId: 'message', text: 'a' },
      { runId: 'run', messageId: '', text: 'a' },
      { runId: 'run', messageId: 'message', text: 'a', seq: 1 },
      { runId: 'run', messageId: 'message', text: 'a'.repeat(2_000_001) },
    ])
      expect(Value.Check(LiveMessageDeltaSchema, value)).toBe(false);
  });

  it('streams partial text without advancing the committed sequence and resets its live revision on commit', () => {
    const initial = sessionProjection(7, 'prefix', 2);
    const live = sessionProjection(7, 'prefix append', 5);
    const delta = patch(createSessionUpdate(initial, live));
    expect(delta).toMatchObject({
      baseSeq: 7,
      baseLiveRevision: 2,
      snapshotSeq: 7,
      liveRevision: 5,
    });
    expect(delta.changes).toEqual([
      { type: 'message.append', id: 'assistant', textDelta: ' append', thinkingDelta: '' },
    ]);
    expect(createSessionUpdate(live, initial)).toBeUndefined();
    const committed = sessionProjection(8, 'final', 0);
    projectionMessage(committed).status = 'complete';
    expect(patch(createSessionUpdate(live, committed))).toMatchObject({
      baseSeq: 7,
      baseLiveRevision: 5,
      snapshotSeq: 8,
      liveRevision: 0,
    });
  });

  it('starts from one authoritative snapshot and does not resend an unchanged sequence', () => {
    const initial = sessionProjection();
    expect(createSessionUpdate(undefined, initial)).toEqual({
      kind: 'snapshot',
      snapshot: initial,
    });
    expect(createSessionUpdate(initial, structuredClone(initial))).toBeUndefined();
  });

  it('transmits only appended text and thinking without repeating history or the prefix', () => {
    const prefix = 'large stable body '.repeat(2000);
    const initial = sessionProjection(4, prefix);
    const next = sessionProjection(9, `${prefix}new characters`);
    projectionMessage(initial).thinking = 'earlier reasoning';
    projectionMessage(next).thinking = 'earlier reasoning and more';
    const update = patch(createSessionUpdate(initial, next));
    expect(update).toMatchObject({ baseSeq: 4, snapshotSeq: 9, branchId: 'main' });
    expect(update.changes).toEqual([
      {
        type: 'message.append',
        id: 'assistant',
        textDelta: 'new characters',
        thinkingDelta: ' and more',
      },
    ]);
    expect(JSON.stringify(update)).not.toContain(prefix);
    expect(JSON.stringify(update)).not.toContain('Request');
    expect(JSON.stringify(update).length).toBeLessThan(1000);
  });

  it('calibrates terminal and rewritten messages with their exact full value', () => {
    const initial = sessionProjection(3, 'preliminary');
    const rewritten = sessionProjection(5, 'replacement');
    expect(patch(createSessionUpdate(initial, rewritten)).changes).toEqual([
      { type: 'message.set', index: 1, message: projectionMessage(rewritten) },
    ]);
    const final = sessionProjection(7, 'preliminary final');
    projectionMessage(final).status = 'complete';
    projectionMessage(final).stopReason = 'stop';
    expect(patch(createSessionUpdate(initial, final)).changes).toEqual([
      { type: 'message.set', index: 1, message: projectionMessage(final) },
    ]);
  });

  it('publishes only changed tool, run, queue and branch entities in stable order', () => {
    const initial = sessionProjection(1);
    const next = sessionProjection(8);
    next.branches.push({
      id: 'other',
      sessionId: 'session',
      parentId: 'main',
      forkMessageId: 'user',
      createdAt: 3,
    });
    next.runs = next.runs.map((run) => ({ ...run, status: 'completed', finishedAt: 3 }));
    next.queue = [
      {
        id: 'queued',
        sessionId: 'session',
        text: 'next',
        mode: 'follow-up',
        providerId: 'provider',
        modelId: 'model',
        createdAt: 3,
        updatedAt: 3,
        revision: 1,
      },
    ];
    next.tools = [
      {
        id: 'tool',
        sessionId: 'session',
        runId: 'run',
        branchId: 'main',
        name: 'read',
        arguments: { path: 'a.txt' },
        status: 'completed',
        binding: { kind: 'accepted', source: { kind: 'workspace' }, fingerprint: 'a'.repeat(64) },
        dispatch: { state: 'not_applicable' },
        summary: 'read a.txt',
        result: 'body',
        diff: null,
        createdAt: 3,
        updatedAt: 4,
        afterMessageId: 'assistant',
      },
    ];
    expect(patch(createSessionUpdate(initial, next)).changes.map(({ type }) => type)).toEqual([
      'branch.set',
      'run.set',
      'queue.set',
      'tool.set',
    ]);
  });

  it('emits removals before insertions so the supplied indices describe the resulting collection', () => {
    const initial = sessionProjection(1);
    const next = sessionProjection(4);
    next.messages = [
      { ...projectionMessage(next, 'user'), id: 'new-user', text: 'different request' },
      projectionMessage(next),
    ];
    expect(patch(createSessionUpdate(initial, next)).changes).toEqual([
      { type: 'message.remove', id: 'user' },
      { type: 'message.set', index: 0, message: next.messages[0] },
    ]);
  });

  it('resets the baseline for selected-branch changes and reordered existing rows', () => {
    const initial = sessionProjection(1);
    const next = sessionProjection(4);
    next.session.activeBranchId = 'revision';
    expect(createSessionUpdate(initial, next)).toEqual({ kind: 'snapshot', snapshot: next });
    const reordered = sessionProjection(5);
    reordered.messages.reverse();
    expect(createSessionUpdate(initial, reordered)?.kind).toBe('snapshot');
  });

  it('bounds both the number and serialized bytes of a patch', () => {
    const initial = sessionProjection(1, '');
    const many = sessionProjection(4, '');
    many.messages = Array.from({ length: 257 }, (_unused, index) => ({
      ...projectionMessage(initial),
      id: `new-${index}`,
    }));
    expect(createSessionUpdate(initial, many)?.kind).toBe('snapshot');
    const large = sessionProjection(5, 'x'.repeat(600_000));
    expect(createSessionUpdate(initial, large)?.kind).toBe('snapshot');
    expect(
      Value.Check(SessionStreamUpdateSchema, {
        ...patch(createSessionUpdate(initial, sessionProjection(6, 'small'))),
        changes: Array.from({ length: 257 }, () => ({ type: 'message.remove', id: 'x' })),
      }),
    ).toBe(false);
  });

  it('advances the sequence for work-only commits without repeating unchanged collections', () => {
    const update = patch(createSessionUpdate(sessionProjection(2), sessionProjection(9)));
    expect(update.changes).toEqual([]);
    expect(update.session.snapshotSeq).toBe(9);
  });
});
