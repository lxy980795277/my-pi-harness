import type { SessionPatch, SessionStreamUpdate } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import { projectionMessage, sessionProjection } from '../../../tests/fixtures/session-projection';
import { applySessionStreamUpdate } from '../src/features/sessions/queries/session-stream';
import { mergeSessionSnapshot } from '../src/features/sessions/queries/projection';
import { QueryClient } from '@tanstack/react-query';

const append = (baseSeq = 1, snapshotSeq = 2): SessionPatch => {
  return {
    kind: 'patch',
    sessionId: 'session',
    branchId: 'main',
    baseSeq,
    snapshotSeq,
    session: sessionProjection(snapshotSeq).session,
    changes: [
      { type: 'message.append', id: 'assistant', textDelta: ' next', thinkingDelta: 'reasoning' },
    ],
  };
};

describe('session stream projection reducer', () => {
  it('appends text and reasoning while preserving all stable entities and collection references', () => {
    const initial = sessionProjection();
    const next = applySessionStreamUpdate(initial, append(), 'session');
    expect(projectionMessage(next)).toMatchObject({ text: 'initial next', thinking: 'reasoning' });
    expect(next.messages[0]).toBe(initial.messages[0]);
    expect(next.branches).toBe(initial.branches);
    expect(next.runs).toBe(initial.runs);
    expect(next.tools).toBe(initial.tools);
    expect(next.queue).toBe(initial.queue);
    expect(projectionMessage(initial).text).toBe('initial');
  });

  it('ignores duplicate and stale batches but rejects gaps, overlap and branch changes without a baseline', () => {
    const initial = sessionProjection(3);
    expect(applySessionStreamUpdate(initial, append(1, 2), 'session')).toBe(initial);
    expect(applySessionStreamUpdate(initial, append(2, 3), 'session')).toBe(initial);
    expect(() => applySessionStreamUpdate(initial, append(4, 5), 'session')).toThrow('缺口');
    expect(() => applySessionStreamUpdate(initial, append(1, 4), 'session')).toThrow('缺口');
    expect(() => applySessionStreamUpdate(undefined, append(), 'session')).toThrow('缺口');
    const otherBranch = {
      ...append(3, 4),
      branchId: 'revision',
      session: { ...sessionProjection(4).session, activeBranchId: 'revision' },
    };
    expect(() => applySessionStreamUpdate(initial, otherBranch, 'session')).toThrow('缺口');
  });

  it('replaces terminal and non-append messages exactly, then rejects appending after completion', () => {
    const final = {
      ...projectionMessage(sessionProjection(3)),
      text: 'exact final answer',
      thinking: 'final reasoning',
      status: 'complete' as const,
      stopReason: 'stop',
    };
    const update = append(1, 3);
    update.changes = [{ type: 'message.set', index: 1, message: final }];
    const current = applySessionStreamUpdate(sessionProjection(), update, 'session');
    expect(projectionMessage(current)).toEqual(final);
    expect(() => applySessionStreamUpdate(current, append(3, 4), 'session')).toThrow('正在生成');
  });

  it('uses a fresh snapshot for branch replacement and retains newer state when an older snapshot arrives', () => {
    const initial = sessionProjection(3);
    const replacement = sessionProjection(5);
    replacement.branches.push({
      id: 'revision',
      sessionId: 'session',
      parentId: 'main',
      forkMessageId: 'user',
      createdAt: 4,
    });
    replacement.session.activeBranchId = 'revision';
    const next = applySessionStreamUpdate(
      initial,
      { kind: 'snapshot', snapshot: replacement },
      'session',
    );
    expect(next.session.activeBranchId).toBe('revision');
    expect(applySessionStreamUpdate(next, { kind: 'snapshot', snapshot: initial }, 'session')).toBe(
      next,
    );
  });

  it('applies insertions/removals in exact order and updates tools without replacing unrelated rows', () => {
    const initial = sessionProjection();
    const update = append();
    const user = { ...projectionMessage(initial, 'user'), id: 'replacement', text: 'replacement' };
    update.changes = [
      { type: 'message.remove', id: 'user' },
      { type: 'message.set', index: 0, message: user },
      {
        type: 'tool.set',
        index: 0,
        tool: {
          id: 'tool',
          sessionId: 'session',
          branchId: 'main',
          runId: 'run',
          name: 'read',
          arguments: {},
          status: 'running',
          summary: 'read',
          result: null,
          diff: null,
          createdAt: 2,
          updatedAt: 2,
          afterMessageId: 'assistant',
        },
      },
    ];
    const next = applySessionStreamUpdate(initial, update, 'session');
    expect(next.messages.map(({ id }) => id)).toEqual(['replacement', 'assistant']);
    expect(next.messages[1]).toBe(initial.messages[1]);
    expect(next.tools[0]?.id).toBe('tool');
  });

  it('rejects inconsistent identities and invalid operations atomically', () => {
    const initial = sessionProjection();
    const cases: SessionStreamUpdate[] = [
      { ...append(), sessionId: 'another' },
      { ...append(), session: sessionProjection(9).session },
      { ...append(), snapshotSeq: 1 },
      { ...append(), changes: [{ type: 'message.remove', id: 'missing' }] },
      {
        ...append(),
        changes: [{ type: 'message.set', index: 3, message: projectionMessage(initial) }],
      },
      {
        ...append(),
        changes: [
          {
            type: 'message.set',
            index: 1,
            message: { ...projectionMessage(initial), sessionId: 'another' },
          },
        ],
      },
      {
        ...append(),
        changes: [{ type: 'message.set', index: 0, message: projectionMessage(initial) }],
      },
      { ...append(), changes: [...append().changes, ...append().changes] },
      { ...append(), changes: [{ type: 'branch.remove', id: 'main' }] },
    ];
    for (const update of cases)
      expect(() => applySessionStreamUpdate(initial, update, 'session')).toThrow();
    expect(initial).toEqual(sessionProjection());
  });

  it('rejects duplicated/foreign snapshot rows and mismatched snapshot cursors', () => {
    const duplicate = sessionProjection();
    duplicate.messages.push(projectionMessage(duplicate));
    expect(() =>
      applySessionStreamUpdate(undefined, { kind: 'snapshot', snapshot: duplicate }, 'session'),
    ).toThrow('重复');
    expect(() =>
      applySessionStreamUpdate(
        undefined,
        { kind: 'snapshot', snapshot: sessionProjection() },
        'another',
      ),
    ).toThrow('标识');
    const wrongSeq = sessionProjection();
    wrongSeq.snapshotSeq = 2;
    expect(() =>
      applySessionStreamUpdate(undefined, { kind: 'snapshot', snapshot: wrongSeq }, 'session'),
    ).toThrow('序号');
  });

  it('keeps a newer HTTP command fact while the independent stream catches up in order', () => {
    const client = new QueryClient();
    let stream = sessionProjection(1);
    mergeSessionSnapshot(client, stream);
    mergeSessionSnapshot(client, sessionProjection(4, 'newer command result'));
    stream = applySessionStreamUpdate(stream, append(1, 2), 'session');
    mergeSessionSnapshot(client, stream);
    stream = applySessionStreamUpdate(stream, append(2, 3), 'session');
    mergeSessionSnapshot(client, stream);
    expect(client.getQueryData(['session', 'session'])).toMatchObject({
      snapshotSeq: 4,
      messages: [{}, { text: 'newer command result' }],
    });
    client.clear();
  });
});
