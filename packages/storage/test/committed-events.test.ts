import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { HarnessEvent } from '@my-pi-harness/protocol';
import { openProfileStore, type ProfileStore } from '../src/index';
import { SessionJournal } from '../src/sessions/session-jsonl';

interface Fixture {
  directory: string;
  store: ProfileStore;
}
const owned: Fixture[] = [];

async function fixture(): Promise<ProfileStore> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'committed-events-')));
  const store = await openProfileStore(directory);
  owned.push({ directory, store });
  store.createSession({
    id: 'session',
    branchId: 'main',
    title: 'Initial',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: null,
    approvalMode: 'ask',
    at: 1,
  });
  return store;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { directory, store } of owned.splice(0)) {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('notifies once for a committed event batch after its query projections are available', async () => {
  const store = await fixture();
  const observed: string[] = [];
  const receive = vi.fn((events: readonly HarnessEvent[]) => {
    expect(store.getSession('session')?.title).toBe('Committed');
    expect(store.readEvents('session', 1)).toHaveLength(2);
    observed.push(...events.map((event) => event.type));
  });
  const failed = vi.fn();
  const dispose = store.subscribeCommitted(receive, failed);
  store.append('session', [
    { type: 'session.configured', runId: null, at: 2, data: { title: 'Committed' } },
    { type: 'session.audit', runId: null, at: 3, data: { reason: 'Audit' } },
  ]);
  expect(receive).toHaveBeenCalledTimes(1);
  expect(failed).not.toHaveBeenCalled();
  expect(observed).toEqual(['session.configured', 'session.audit']);
  dispose();
  store.append('session', [
    { type: 'session.audit', runId: null, at: 4, data: { reason: 'After disposal' } },
  ]);
  expect(receive).toHaveBeenCalledTimes(1);
});

it('does not notify observers when the journal transaction fails', async () => {
  const store = await fixture();
  const receive = vi.fn();
  store.subscribeCommitted(receive, vi.fn());
  vi.spyOn(SessionJournal.prototype, 'append').mockImplementationOnce(() => {
    throw new Error('Injected journal failure');
  });
  expect(() =>
    store.append('session', [
      { type: 'session.configured', runId: null, at: 2, data: { title: 'Not committed' } },
    ]),
  ).toThrow('outcome may be unknown');
  expect(receive).not.toHaveBeenCalled();
  expect(store.getSession('session')?.title).toBe('Initial');
});

it('isolates failing observers and their diagnostics from the durable result and later observers', async () => {
  const store = await fixture();
  const failed = vi.fn(() => {
    throw new Error('Diagnostic observer failed');
  });
  store.subscribeCommitted(() => {
    throw new Error('Primary observer failed');
  }, failed);
  const later = vi.fn();
  store.subscribeCommitted(later, vi.fn());
  expect(() =>
    store.append('session', [
      { type: 'session.configured', runId: null, at: 2, data: { title: 'Durable' } },
    ]),
  ).not.toThrow();
  expect(store.getSession('session')?.title).toBe('Durable');
  expect(store.readEvents('session', 1)).toHaveLength(1);
  expect(failed).toHaveBeenCalledTimes(1);
  expect(later).toHaveBeenCalledTimes(1);
});
