import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAgentChangeStream } from '../src/agents/change-stream.js';

class ResponseFixture extends EventEmitter {
  destroyed = false;
  ended = false;
  writable = true;
  records: string[] = [];
  write(chunk: string): boolean {
    this.records.push(chunk);
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

function fixture(revokeOnWatch = false) {
  const response = new ResponseFixture();
  const changes = new EventEmitter();
  const revocations = new EventEmitter();
  const closed = vi.fn();
  const unsubscribed = vi.fn();
  const unwatched = vi.fn();
  const state = { authorized: true };
  const close = startAgentChangeStream({
    response,
    authorized: () => state.authorized,
    subscribe: (listener) => {
      changes.on('change', listener);
      return () => {
        changes.off('change', listener);
        unsubscribed();
      };
    },
    watchAuthorization: (listener) => {
      revocations.on('revoke', listener);
      if (revokeOnWatch) listener();
      return () => {
        revocations.off('revoke', listener);
        unwatched();
      };
    },
    onClose: closed,
  });
  return { response, changes, revocations, state, closed, unsubscribed, unwatched, close };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('shared task invalidation stream', () => {
  it('starts with a fresh-read marker and batches unrelated task changes without carrying task text', () => {
    const f = fixture();
    expect(f.response.records).toEqual(['event: agents.changed\ndata: {"kind":"ready"}\n\n']);
    f.changes.emit('change');
    f.changes.emit('change');
    vi.advanceTimersByTime(99);
    expect(f.response.records).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(f.response.records).toEqual([
      'event: agents.changed\ndata: {"kind":"ready"}\n\n',
      'event: agents.changed\ndata: {"kind":"changed"}\n\n',
    ]);
    f.close();
    f.close();
    expect(f.closed).toHaveBeenCalledTimes(1);
    expect(f.changes.listenerCount('change')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases both subscription owners when authorization is revoked during setup', () => {
    const f = fixture(true);
    expect(f.response.records).toHaveLength(0);
    expect(f.response.ended).toBe(true);
    expect(f.unsubscribed).toHaveBeenCalledTimes(1);
    expect(f.unwatched).toHaveBeenCalledTimes(1);
    expect(f.revocations.listenerCount('revoke')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    f.close();
  });

  it('does not send pending task changes after revocation or socket closure', () => {
    for (const socketClosed of [false, true]) {
      const f = fixture();
      f.changes.emit('change');
      if (socketClosed) f.response.emit('close');
      else f.revocations.emit('revoke');
      vi.advanceTimersByTime(20_000);
      expect(f.response.records).toHaveLength(1);
      expect(f.unsubscribed).toHaveBeenCalledTimes(1);
      expect(f.unwatched).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      f.close();
    }
  });

  it('disconnects a slow consumer instead of accumulating task notifications', () => {
    const f = fixture();
    f.response.writable = false;
    f.changes.emit('change');
    vi.advanceTimersByTime(100);
    expect(f.response.destroyed).toBe(true);
    expect(f.closed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    f.close();
  });

  it('rechecks authorization on heartbeats and releases an unwritable ending socket', () => {
    const f = fixture();
    vi.spyOn(f.response, 'end').mockImplementation(() => {
      throw new Error('Socket closed');
    });
    f.state.authorized = false;
    vi.advanceTimersByTime(15_000);
    expect(f.response.destroyed).toBe(true);
    expect(f.unsubscribed).toHaveBeenCalledTimes(1);
    expect(f.unwatched).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
