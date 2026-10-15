import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModels, fauxProvider } from '@earendil-works/pi-ai';
import { openProfileStore } from '@my-pi-harness/storage';
import { describe, expect, it } from 'vitest';
import type { SessionRuntimeOptions } from '../src/session-runtime.js';
import { SessionRuntime } from '../src/session-runtime.js';

function gate() {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function fixture(gateway: SessionRuntimeOptions['gateway']) {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-start-cancel-'));
  const store = await openProfileStore(directory);
  const runtime = new SessionRuntime({ store, gateway, onError: () => {} });
  const session = runtime.createSession({
    title: 'Pending start',
    providerId: 'fixture',
    modelId: 'fixture',
    thinkingLevel: 'off',
    workspaceId: null,
    approvalMode: 'ask',
  });
  return {
    runtime,
    session,
    async close() {
      await runtime.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe('stopping queued and preparing model starts', () => {
  it('stops a same-tick queued send before resolving a model or accepting input', async () => {
    let resolved = false;
    const f = await fixture({
      resolve: () => {
        resolved = true;
        return Promise.reject(new Error('Stopped input must not resolve a model'));
      },
    });
    try {
      const sent = f.runtime.send(f.session.id, {
        text: 'Never accepted',
        mode: 'send',
        requestId: 'same-tick',
      });
      const rejected = expect(sent).rejects.toMatchObject({ name: 'AbortError' });
      await f.runtime.cancel(f.session.id);
      await rejected;
      expect(resolved).toBe(false);
      expect(f.runtime.getSnapshot(f.session.id)).toMatchObject({ messages: [], runs: [] });
    } finally {
      await f.close();
    }
  });

  for (const action of ['stop', 'close'] as const) {
    it(`aborts model authorization during ${action} without accepting a run`, async () => {
      const entered = gate();
      let aborted = false;
      const f = await fixture({
        resolve: async (_provider, _model, signal) => {
          if (!signal) throw new Error('Missing authorization cancellation signal');
          const pending = new Promise<never>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(new DOMException('Stopped authorization', 'AbortError'));
              },
              { once: true },
            );
          });
          entered.release();
          return await pending;
        },
      });
      try {
        const sent = f.runtime.send(f.session.id, {
          text: 'Waiting for credentials',
          mode: 'send',
          requestId: action,
        });
        const rejected = expect(sent).rejects.toMatchObject({ name: 'AbortError' });
        await entered.promise;
        if (action === 'stop') await f.runtime.cancel(f.session.id);
        else await f.runtime.close();
        await rejected;
        expect(aborted).toBe(true);
        expect(f.runtime.getSnapshot(f.session.id)).toMatchObject({ messages: [], runs: [] });
      } finally {
        await f.close();
      }
    });
  }

  it('releases a resolved lease if authorization finishes after stop was requested', async () => {
    const entered = gate();
    const finish = gate();
    let releases = 0;
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const f = await fixture({
      resolve: async () => {
        entered.release();
        await finish.promise;
        return {
          model: faux.models[0],
          streamFn: models.streamSimple.bind(models),
          release: () => {
            releases += 1;
          },
        };
      },
    });
    try {
      const sent = f.runtime.send(f.session.id, {
        text: 'Waiting',
        mode: 'send',
        requestId: 'late-lease',
      });
      const rejected = expect(sent).rejects.toMatchObject({ name: 'AbortError' });
      await entered.promise;
      const stopped = f.runtime.cancel(f.session.id);
      finish.release();
      await stopped;
      await rejected;
      expect(releases).toBe(1);
      expect(f.runtime.getSnapshot(f.session.id)).toMatchObject({ messages: [], runs: [] });
    } finally {
      finish.release();
      await f.close();
    }
  });
});
