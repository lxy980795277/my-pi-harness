import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileChangeActions } from '../src/features/file-changes/components/file-change-actions';
import { FileChangeRow } from '../src/features/file-changes/components/file-change-row';
import { useFileChangesStore } from '../src/features/file-changes/stores/file-changes';
import {
  fileChangeSelectable,
  fileChangeStateLabel,
  supportsFileChanges,
  mergeFileChangeReceipt,
} from '../src/features/file-changes/utils/file-change-view';
import { fileBatchFixture, fileChangeFixture, fileToolFixture } from './fixtures/file-changes';

beforeEach(() => {
  useFileChangesStore.getState().reset();
});

describe('file-change navigation and uncertain intent', () => {
  it('disables imported-history selection and every batch or whole-answer control', () => {
    const actions = renderToStaticMarkup(
      createElement(FileChangeActions, {
        scope: { inputMessageId: 'imported-input' },
        selectedIds: [],
        blocked: true,
        onOperate: () => {
          return;
        },
      }),
    );
    expect(actions.match(/disabled=""/g)).toHaveLength(4);
    const row = renderToStaticMarkup(
      createElement(FileChangeRow, {
        change: fileChangeFixture({ local: false, undoAvailable: false, redoAvailable: false }),
        selected: false,
        active: false,
        limitReached: false,
        onSelect: () => {
          return;
        },
        onToggle: () => {
          return;
        },
      }),
    );
    expect(row.match(/disabled=""/g)).toHaveLength(1);
    expect(row).toContain('选择变更');
  });
  it('keeps cross-page IDs and host-provided descending cursors, then resets the view on scope changes', () => {
    const actions = useFileChangesStore.getState();
    actions.open('session', { inputMessageId: 'input' });
    actions.toggle('older-chain-edit');
    actions.select('older-chain-edit');
    actions.next(7);
    actions.toggle('newer-chain-edit');
    expect(useFileChangesStore.getState()).toMatchObject({
      selectedIds: ['older-chain-edit', 'newer-chain-edit'],
      positions: [undefined, 7],
      changeId: null,
    });
    actions.previous();
    expect(useFileChangesStore.getState().positions).toEqual([undefined]);
    actions.open('other', { toolCallId: 'child-tool' });
    actions.close('session');
    expect(useFileChangesStore.getState()).toMatchObject({
      sessionId: 'other',
      selectedIds: [],
      positions: [undefined],
    });
  });

  it('preserves the exact unconfirmed operation across close/reopen and ignores late acknowledgement for another ID', () => {
    const actions = useFileChangesStore.getState();
    const input = {
      operationId: 'original-op',
      action: 'undo' as const,
      selection: { kind: 'answer' as const, inputMessageId: 'root-input' },
    };
    actions.begin('session', input);
    actions.begin('session', { ...input, operationId: 'replacement-op' });
    actions.close();
    actions.open('other', {});
    actions.acknowledge('session', 'replacement-op');
    expect(useFileChangesStore.getState().unconfirmed.session).toEqual(input);
    actions.open('session', { inputMessageId: 'root-input' });
    expect(useFileChangesStore.getState().operationIds.session).toBe('original-op');
    actions.acknowledge('session', 'original-op');
    expect(useFileChangesStore.getState().unconfirmed.session).toBeUndefined();
    expect(useFileChangesStore.getState().operationIds.session).toBe('original-op');
    actions.reset();
    expect(useFileChangesStore.getState()).toMatchObject({
      operationIds: {},
      unconfirmed: {},
      sessionId: null,
    });
  });

  it('allows a blocked intermediate edit in a batch but never invents native history for shell or MCP calls', () => {
    const intermediate = fileChangeFixture({ undoAvailable: false, blockedReason: '存在后续修改' });
    expect(fileChangeSelectable(intermediate)).toBe(true);
    expect(fileChangeSelectable(fileChangeFixture({ local: false }))).toBe(false);
    expect(supportsFileChanges(fileToolFixture())).toBe(true);
    expect(supportsFileChanges(fileToolFixture({ name: 'run_command' }))).toBe(false);
    expect(
      supportsFileChanges(
        fileToolFixture({
          binding: {
            kind: 'accepted',
            source: {
              kind: 'mcp',
              serverId: 'remote',
              serverRevision: 1,
              remoteToolName: 'write_file',
            },
            fingerprint: 'a'.repeat(64),
          },
        }),
      ),
    ).toBe(false);
    expect(
      fileChangeStateLabel(fileChangeFixture({ status: 'unknown', state: 'unavailable' })),
    ).toBe('结果未知');
  });

  it('stops tracking only the uncertain intent and leaves another inspected durable operation selected', () => {
    const actions = useFileChangesStore.getState();
    actions.begin('session', {
      operationId: 'uncertain',
      action: 'undo',
      selection: { kind: 'changes', changeIds: ['change'] },
    });
    actions.inspect('session', 'other-durable-operation');
    actions.stopTracking('session', 'uncertain');
    expect(useFileChangesStore.getState().unconfirmed.session).toBeUndefined();
    expect(useFileChangesStore.getState().operationIds.session).toBe('other-durable-operation');
  });

  it('never regresses terminal or cancellation facts when acceptance arrives after a newer GET', () => {
    const accepted = fileBatchFixture();
    const running = fileBatchFixture({ status: 'running', updatedAt: 100 });
    const cancelled = fileBatchFixture({ status: 'running', cancelRequested: true, updatedAt: 90 });
    const completed = fileBatchFixture({ status: 'completed', finishedAt: 80, updatedAt: 80 });
    expect(mergeFileChangeReceipt(running, accepted)).toBe(running);
    expect(mergeFileChangeReceipt(cancelled, running)).toBe(cancelled);
    expect(mergeFileChangeReceipt(completed, accepted)).toBe(completed);
    expect(mergeFileChangeReceipt(accepted, completed)).toBe(completed);
  });

  it('limits explicit selections to the public batch maximum without limiting a whole-answer selector to mounted rows', () => {
    const actions = useFileChangesStore.getState();
    for (let i = 0; i < 51; i++) actions.toggle('change-' + i);
    expect(useFileChangesStore.getState().selectedIds).toHaveLength(50);
    actions.toggle('change-0');
    actions.toggle('change-50');
    expect(useFileChangesStore.getState().selectedIds).toContain('change-50');
  });
});
