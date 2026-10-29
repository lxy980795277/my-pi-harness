import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionProjection } from '../../../tests/fixtures/session-projection.js';
import { startSessionStream } from '../src/sessions/stream-connection.js';

class StreamResponseFixture extends EventEmitter {
  destroyed = false;
  ended = false;
  writable = true;
  records: string[] = [];
  write(record: string): boolean {
    this.records.push(record);
    return this.writable;
  }
  end(): void {
    this.ended = true;
  }
  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
}

const fixture = () => {
  const response = new StreamResponseFixture();
  const state = { snapshot: sessionProjection(), authorized: true };
  const changes = new EventEmitter();
  const revocations = new EventEmitter();
  const unsubscribed = vi.fn();
  const unwatched = vi.fn();
  const closed = vi.fn();
  const reads = vi.fn(() => state.snapshot);
  const start = (revokeOnWatch = false) =>
    startSessionStream({
      response,
      snapshot: reads,
      authorized: () => state.authorized,
      subscribe: (changed) => {
        changes.on('change', changed);
        return () => {
          changes.off('change', changed);
          unsubscribed();
        };
      },
      watchAuthorization: (revoked) => {
        revocations.on('revoke', revoked);
        if (revokeOnWatch) revoked();
        return () => {
          revocations.off('revoke', revoked);
          unwatched();
        };
      },
      onClose: closed,
    });
  return { response, state, changes, revocations, unsubscribed, unwatched, closed, reads, start };
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('bounded session SSE writer lifecycle', () => {
  it('does not rebuild the main transcript for child deltas and keeps the next root interval exact', () => {
    const f = fixture();
    const close = f.start();
    f.state.snapshot = sessionProjection(1, 'initial', 4);
    f.changes.emit('change', { type: 'message.delta', runId: 'child-run' });
    vi.advanceTimersByTime(32);
    expect(f.reads).toHaveBeenCalledTimes(1);
    expect(f.response.records).toHaveLength(1);
    f.state.snapshot = sessionProjection(1, 'initial root extension', 7);
    f.changes.emit('change', { type: 'message.delta', runId: 'run' });
    vi.advanceTimersByTime(32);
    expect(f.reads).toHaveBeenCalledTimes(2);
    expect(f.response.records[1]).toContain('id: 1:7');
    expect(f.response.records[1]).toContain(
      '"baseSeq":1,"baseLiveRevision":0,"snapshotSeq":1,"liveRevision":7',
    );
    expect(f.response.records[1]).toContain('root extension');
    close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for drain and collapses intermediate commits into one latest transition', () => {
    const f = fixture();
    f.response.writable = false;
    const close = f.start();
    expect(f.response.destroyed).toBe(false);
    expect(f.response.records).toHaveLength(1);
    f.state.snapshot = sessionProjection(2, 'initial intermediate');
    f.changes.emit('change');
    f.state.snapshot = sessionProjection(8, 'initial final');
    f.changes.emit('change');
    vi.advanceTimersByTime(4999);
    expect(f.response.records).toHaveLength(1);
    expect(f.reads).toHaveBeenCalledTimes(1);
    f.response.writable = true;
    f.response.emit('drain');
    vi.advanceTimersByTime(32);
    expect(f.response.records).toHaveLength(2);
    expect(f.reads).toHaveBeenCalledTimes(2);
    expect(f.response.records[1]).toContain(
      '"baseSeq":1,"baseLiveRevision":0,"snapshotSeq":8,"liveRevision":0',
    );
    expect(f.response.records[1]).toContain('"textDelta":" final"');
    close();
    expect(f.response.ended).toBe(true);
    expect(f.response.destroyed).toBe(false);
    expect(f.unsubscribed).toHaveBeenCalledTimes(1);
    expect(f.unwatched).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('destroys a permanently blocked socket at five seconds and immediately releases its owners', () => {
    const f = fixture();
    f.response.writable = false;
    const close = f.start();
    f.changes.emit('change');
    vi.advanceTimersByTime(5000);
    expect(f.response.destroyed).toBe(true);
    expect(f.response.listenerCount('drain')).toBe(0);
    expect(f.changes.listenerCount('change')).toBe(0);
    expect(f.revocations.listenerCount('revoke')).toBe(0);
    expect(f.closed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    close();
    f.response.emit('drain');
    expect(f.unsubscribed).toHaveBeenCalledTimes(1);
    expect(f.unwatched).toHaveBeenCalledTimes(1);
  });

  it('uses the same drain timeout for a backpressured heartbeat and emits no later heartbeat', () => {
    const f = fixture();
    const close = f.start();
    f.response.writable = false;
    vi.advanceTimersByTime(15_000);
    expect(f.response.records.at(-1)).toBe(': heartbeat\n\n');
    expect(f.response.destroyed).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(f.response.destroyed).toBe(true);
    expect(f.response.records).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    close();
  });

  it('ends writable streams on revocation or shutdown without sending pending changes', () => {
    for (const action of ['revoke', 'shutdown']) {
      const f = fixture();
      const close = f.start();
      f.state.snapshot = sessionProjection(2, 'new content');
      f.changes.emit('change');
      if (action === 'revoke') f.revocations.emit('revoke');
      else close();
      vi.advanceTimersByTime(32);
      expect(f.response.ended).toBe(true);
      expect(f.response.destroyed).toBe(false);
      expect(f.response.records).toHaveLength(1);
      expect(f.unsubscribed).toHaveBeenCalledTimes(1);
      expect(f.unwatched).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('destroys backpressured streams immediately on revocation or shutdown', () => {
    for (const action of ['revoke', 'shutdown']) {
      const f = fixture();
      f.response.writable = false;
      const close = f.start();
      f.state.snapshot = sessionProjection(2, 'new content');
      f.changes.emit('change');
      if (action === 'revoke') f.revocations.emit('revoke');
      else close();
      expect(f.response.destroyed).toBe(true);
      expect(f.response.ended).toBe(false);
      expect(f.response.records).toHaveLength(1);
      expect(f.response.listenerCount('drain')).toBe(0);
      expect(f.response.listenerCount('close')).toBe(0);
      expect(f.unsubscribed).toHaveBeenCalledTimes(1);
      expect(f.unwatched).toHaveBeenCalledTimes(1);
      expect(f.closed).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      f.response.emit('drain');
      close();
      expect(f.unsubscribed).toHaveBeenCalledTimes(1);
      expect(f.unwatched).toHaveBeenCalledTimes(1);
    }
  });

  it('releases subscriptions when authorization is revoked while its watcher is installed', () => {
    const f = fixture();
    const close = f.start(true);
    expect(f.response.ended).toBe(true);
    expect(f.response.destroyed).toBe(false);
    expect(f.response.records).toHaveLength(0);
    expect(f.reads).not.toHaveBeenCalled();
    expect(f.changes.listenerCount('change')).toBe(0);
    expect(f.revocations.listenerCount('revoke')).toBe(0);
    expect(f.response.listenerCount('close')).toBe(0);
    expect(f.unsubscribed).toHaveBeenCalledTimes(1);
    expect(f.unwatched).toHaveBeenCalledTimes(1);
    expect(f.closed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    close();
    expect(f.closed).toHaveBeenCalledTimes(1);
  });

  it('releases owners if the response was already destroyed before stream setup', () => {
    const f = fixture();
    f.response.destroyed = true;
    const close = f.start();
    expect(f.response.ended).toBe(false);
    expect(f.response.records).toHaveLength(0);
    expect(f.reads).not.toHaveBeenCalled();
    expect(f.unsubscribed).toHaveBeenCalledTimes(1);
    expect(f.unwatched).toHaveBeenCalledTimes(1);
    expect(f.closed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    close();
    expect(f.closed).toHaveBeenCalledTimes(1);
  });

  it('destroys the socket if a writable response cannot finish after owner cleanup', () => {
    const f = fixture();
    vi.spyOn(f.response, 'end').mockImplementation(() => {
      throw new Error('Response cannot finish');
    });
    const close = f.start();
    f.revocations.emit('revoke');
    expect(f.response.destroyed).toBe(true);
    expect(f.unsubscribed).toHaveBeenCalledTimes(1);
    expect(f.unwatched).toHaveBeenCalledTimes(1);
    expect(f.closed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    close();
    expect(f.closed).toHaveBeenCalledTimes(1);
  });

  it('rejects an unreadable snapshot or oversized record without leaving subscribers or timers', () => {
    const f = fixture();
    const close = f.start();
    f.reads.mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    f.changes.emit('change');
    vi.advanceTimersByTime(32);
    expect(f.response.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    close();

    const large = fixture();
    const body = 'x'.repeat(2_000_000);
    const message = large.state.snapshot.messages[1];
    if (!message) throw new Error('No fixture assistant');
    large.state.snapshot.messages = Array.from({ length: 5 }, (_unused, index) => ({
      ...message,
      id: `large-${index}`,
      text: body,
    }));
    large.start();
    expect(large.response.destroyed).toBe(true);
    expect(large.response.records).toHaveLength(0);
    expect(large.unsubscribed).toHaveBeenCalledTimes(1);
    expect(large.unwatched).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
