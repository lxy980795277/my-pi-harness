import { beforeEach, describe, expect, it } from 'vitest';
import { useArchiveStore } from '../src/features/archives/stores/archives';
import { archiveCanCancel, mergeArchiveJob } from '../src/features/archives/utils/archive-view';
import { archiveJobFixture } from './fixtures/archives';

beforeEach(() => {
  useArchiveStore.getState().reset();
});

describe('archive intent and monotonic observation', () => {
  it('retains only operation identities and an uncertain commit digest across close, then clears them on logout', () => {
    const actions = useArchiveStore.getState();
    actions.openImport();
    actions.track('import', null, 'import-op');
    actions.rememberCommit('import-op', 'a'.repeat(64));
    actions.close();
    actions.openExport('source-session');
    actions.track('export', 'source-session', 'export-op');
    actions.close();
    actions.openImport();
    expect(useArchiveStore.getState()).toMatchObject({
      mode: 'import',
      operationId: 'import-op',
      commitIntents: { 'import-op': 'a'.repeat(64) },
    });
    actions.history();
    actions.select('durable-import');
    expect(useArchiveStore.getState()).toMatchObject({
      mode: 'history',
      operationId: 'durable-import',
    });
    actions.reset();
    expect(useArchiveStore.getState()).toMatchObject({
      mode: null,
      lastOperations: {},
      commitIntents: {},
    });
  });

  it('does not regress publishing or terminal progress when upload acceptance is delayed', () => {
    const ready = archiveJobFixture();
    const publishing = archiveJobFixture({
      status: 'publishing',
      phase: 'publishing',
      updatedAt: 100,
    });
    const complete = archiveJobFixture({
      status: 'completed',
      phase: 'completed',
      updatedAt: 90,
      preview: null,
    });
    expect(mergeArchiveJob(publishing, ready)).toBe(publishing);
    expect(mergeArchiveJob(complete, publishing)).toBe(complete);
    expect(mergeArchiveJob(ready, complete)).toBe(complete);
    expect(archiveCanCancel(publishing)).toBe(false);
    expect(archiveCanCancel(ready)).toBe(true);
  });

  it('accepts a released export file without reviving its old download link from a stale response', () => {
    const available = archiveJobFixture({
      kind: 'export',
      status: 'completed',
      phase: 'completed',
      preview: null,
      downloadAvailable: true,
    });
    const released = { ...available, downloadAvailable: false };
    expect(mergeArchiveJob(available, released)).toBe(released);
    expect(mergeArchiveJob(released, available)).toBe(released);
  });
});
