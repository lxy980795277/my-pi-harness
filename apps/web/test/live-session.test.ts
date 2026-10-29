import type { SessionPatch, SessionStreamUpdate } from '@my-pi-harness/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionProjection } from '../../../tests/fixtures/session-projection';
import { subscribeLiveSession } from '../src/features/sessions/queries/live-session';

class FixtureEventSource extends EventTarget {
  static instances: FixtureEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    super();
    FixtureEventSource.instances.push(this);
  }
  close(): void {
    this.closed = true;
  }
  update(value: SessionStreamUpdate, id?: string): void {
    let cursor: string;
    if (value.kind === 'snapshot')
      cursor = `${value.snapshot.snapshotSeq}:${value.snapshot.liveRevision}`;
    else cursor = `${value.snapshotSeq}:${value.liveRevision}`;
    this.dispatchEvent(
      new MessageEvent('session.update', {
        data: JSON.stringify(value),
        lastEventId: id ?? cursor,
      }),
    );
  }
}

const source = (index = 0): FixtureEventSource => {
  const value = FixtureEventSource.instances[index];
  if (!value) throw new Error('No fixture event source');
  return value;
};
const append = (baseSeq = 1, snapshotSeq = 2): SessionPatch => {
  return {
    kind: 'patch',
    sessionId: 'session',
    branchId: 'main',
    baseSeq,
    baseLiveRevision: 0,
    snapshotSeq,
    liveRevision: 0,
    session: sessionProjection(snapshotSeq).session,
    changes: [{ type: 'message.append', id: 'assistant', textDelta: '+', thinkingDelta: '' }],
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  FixtureEventSource.instances = [];
  vi.stubGlobal('EventSource', FixtureEventSource);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('owned live session subscription', () => {
  it('reconnects from the full partial text at the same durable sequence without replaying a delta', () => {
    const snapshot = vi.fn();
    const close = subscribeLiveSession('session', { snapshot, connection: vi.fn() });
    source().onopen?.();
    source().update({ kind: 'snapshot', snapshot: sessionProjection(3, 'prefix', 2) });
    source().update({ ...append(3, 3), baseLiveRevision: 2, liveRevision: 4 });
    vi.advanceTimersByTime(32);
    expect(snapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ snapshotSeq: 3, liveRevision: 4 }),
    );
    source().onerror?.();
    source().onopen?.();
    source().update({ kind: 'snapshot', snapshot: sessionProjection(3, 'prefix+ caught up', 7) });
    source().update({ ...append(3, 3), baseLiveRevision: 7, liveRevision: 8 });
    vi.advanceTimersByTime(32);
    expect(snapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        snapshotSeq: 3,
        liveRevision: 8,
        messages: [expect.anything(), expect.objectContaining({ text: 'prefix+ caught up+' })],
      }),
    );
    close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reconnects with an actionable error when an opened stream never sends a baseline', () => {
    const snapshot = vi.fn();
    const connection = vi.fn();
    const close = subscribeLiveSession('session', { snapshot, connection });
    source().onopen?.();
    vi.advanceTimersByTime(4999);
    expect(source().closed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(source().closed).toBe(true);
    expect(connection).toHaveBeenLastCalledWith(
      'disconnected',
      expect.stringContaining('未收到会话同步数据'),
    );
    vi.advanceTimersByTime(100);
    source(1).onopen?.();
    source(1).update({ kind: 'snapshot', snapshot: sessionProjection() });
    vi.advanceTimersByTime(5000);
    expect(connection).toHaveBeenLastCalledWith('connected', null);
    expect(source(1).closed).toBe(false);
    expect(snapshot).toHaveBeenCalledTimes(1);
    close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a pending baseline timeout on native disconnect and subscription cleanup', () => {
    const connection = vi.fn();
    const close = subscribeLiveSession('session', { snapshot: vi.fn(), connection });
    source().onopen?.();
    vi.advanceTimersByTime(4000);
    source().onerror?.();
    vi.advanceTimersByTime(2000);
    expect(connection).toHaveBeenLastCalledWith('disconnected', null);
    expect(FixtureEventSource.instances).toHaveLength(1);
    source().onopen?.();
    close();
    vi.advanceTimersByTime(6000);
    expect(FixtureEventSource.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('coalesces sequential batches for 32ms without losing deltas or replaying full HTTP reads', () => {
    const snapshot = vi.fn();
    const connection = vi.fn();
    const close = subscribeLiveSession('session', { snapshot, connection });
    expect(source().url).toBe('/api/sessions/session/events');
    source().onopen?.();
    source().update({ kind: 'snapshot', snapshot: sessionProjection() });
    source().update(append());
    source().update(append(2, 3));
    expect(snapshot).not.toHaveBeenCalled();
    vi.advanceTimersByTime(32);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        snapshotSeq: 3,
        messages: [
          { text: 'Request', ...sessionProjection().messages[0] },
          expect.objectContaining({ text: 'initial++' }),
        ],
      }),
    );
    expect(connection).toHaveBeenLastCalledWith('connected', null);
    close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes a gapped stream and recovers from a fresh snapshot before accepting new patches', () => {
    const snapshot = vi.fn();
    const connection = vi.fn();
    const close = subscribeLiveSession('session', { snapshot, connection });
    source().update({ kind: 'snapshot', snapshot: sessionProjection() });
    source().update(append(3, 4));
    expect(source().closed).toBe(true);
    expect(connection).toHaveBeenLastCalledWith('disconnected', expect.stringContaining('缺口'));
    expect(snapshot).toHaveBeenLastCalledWith(sessionProjection());
    vi.advanceTimersByTime(100);
    source(1).onopen?.();
    source(1).update({ kind: 'snapshot', snapshot: sessionProjection(4, 'restored') });
    source(1).update(append(4, 5));
    vi.advanceTimersByTime(32);
    expect(snapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        snapshotSeq: 5,
        messages: [expect.anything(), expect.objectContaining({ text: 'restored+' })],
      }),
    );
    source().update({ kind: 'snapshot', snapshot: sessionProjection(99, 'late old source') });
    vi.advanceTimersByTime(32);
    expect(snapshot).toHaveBeenCalledTimes(2);
    close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects malformed event cursors and schemas, then backs off without accumulating timers', () => {
    const connection = vi.fn();
    const close = subscribeLiveSession('session', { snapshot: vi.fn(), connection });
    source().update({ kind: 'snapshot', snapshot: sessionProjection() }, '99');
    expect(source().closed).toBe(true);
    expect(connection).toHaveBeenLastCalledWith('disconnected', expect.stringContaining('游标'));
    vi.advanceTimersByTime(100);
    source(1).dispatchEvent(new MessageEvent('session.update', { data: '{broken' }));
    expect(source(1).closed).toBe(true);
    vi.advanceTimersByTime(199);
    expect(FixtureEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FixtureEventSource.instances).toHaveLength(3);
    close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discards pending old-target publication and reconnects on cleanup', () => {
    const snapshot = vi.fn();
    const close = subscribeLiveSession('session', { snapshot, connection: vi.fn() });
    source().update({ kind: 'snapshot', snapshot: sessionProjection() });
    close();
    source().update(append());
    vi.advanceTimersByTime(1000);
    expect(snapshot).not.toHaveBeenCalled();
    expect(source().closed).toBe(true);
    expect(FixtureEventSource.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts a new full baseline after native EventSource reconnects without appending twice', () => {
    const snapshot = vi.fn();
    const connection = vi.fn();
    const close = subscribeLiveSession('session', { snapshot, connection });
    source().onopen?.();
    source().update({ kind: 'snapshot', snapshot: sessionProjection() });
    source().update(append());
    vi.advanceTimersByTime(32);
    source().onerror?.();
    expect(connection).toHaveBeenLastCalledWith('disconnected', null);
    source().onopen?.();
    source().update({ kind: 'snapshot', snapshot: sessionProjection(3, 'authoritative') });
    source().update(append(3, 4));
    vi.advanceTimersByTime(32);
    expect(snapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        snapshotSeq: 4,
        messages: [expect.anything(), expect.objectContaining({ text: 'authoritative+' })],
      }),
    );
    close();
  });
});
