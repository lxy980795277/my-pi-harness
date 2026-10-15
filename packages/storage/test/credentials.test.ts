import { describe, expect, it } from 'vitest';
import { createCredentialStore, createMemoryCredentialStore } from '../src/index.js';

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {
    throw new Error('Gate is not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('opaque credential serialization', () => {
  it('holds the same ref across asynchronous refresh and returns the latest rotated value', async () => {
    const store = createMemoryCredentialStore(new Map([['credential', 'one']]));
    const entered = gate();
    const finish = gate();
    const seen: (string | undefined)[] = [];
    const first = store.modify('credential', async (current) => {
      seen.push(current);
      entered.release();
      await finish.promise;
      return { value: 'two', result: 'first' };
    });
    await entered.promise;
    const second = store.modify('credential', (current) => {
      seen.push(current);
      return Promise.resolve({ value: 'three', result: 'second' });
    });
    const read = store.read('credential');
    try {
      expect(seen).toEqual(['one']);
      finish.release();
      expect(await Promise.all([first, second, read])).toEqual(['first', 'second', 'three']);
      expect(seen).toEqual(['one', 'two']);
    } finally {
      finish.release();
      await Promise.allSettled([first, second, read]);
    }
  });

  it('does not block another ref and keeps write/delete in the same serialization queue', async () => {
    const store = createMemoryCredentialStore(new Map([['a', 'original']]));
    const entered = gate();
    const finish = gate();
    const pending = store.modify('a', async () => {
      entered.release();
      await finish.promise;
      return { value: 'refresh', result: undefined };
    });
    await entered.promise;
    try {
      await store.write('b', 'independent');
      expect(await store.read('b')).toBe('independent');
      const write = store.write('a', 'new value');
      const deleted = store.delete('a');
      finish.release();
      await Promise.all([pending, write, deleted]);
      expect(await store.read('a')).toBeUndefined();
      expect(await store.list()).toEqual(['b']);
    } finally {
      finish.release();
      await pending;
    }
  });

  it('preserves a value for unchanged updates and deletes only when value is explicitly undefined', async () => {
    const store = createMemoryCredentialStore(new Map([['credential', 'opaque JSON']]));
    expect(
      await store.modify('credential', (current) =>
        Promise.resolve({ value: current, result: 'unchanged' }),
      ),
    ).toBe('unchanged');
    expect(await store.read('credential')).toBe('opaque JSON');
    await store.modify('credential', () =>
      Promise.resolve({ value: undefined, result: undefined }),
    );
    expect(await store.read('credential')).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it('propagates unavailable backend errors and allows the next operation to recover', async () => {
    let fail = true;
    const store = createCredentialStore({
      read(): Promise<string | undefined> {
        if (fail) return Promise.reject(new Error('System store is locked'));
        return Promise.resolve('existing');
      },
      write(): Promise<void> {
        return Promise.resolve();
      },
      delete(): Promise<void> {
        return Promise.resolve();
      },
      list(): Promise<string[]> {
        return Promise.resolve([]);
      },
    });
    await expect(
      store.modify('credential', () =>
        Promise.resolve({ value: 'must not overwrite', result: undefined }),
      ),
    ).rejects.toThrow('locked');
    fail = false;
    expect(await store.read('credential')).toBe('existing');
  });
});
