import { initialWorkState, type WorkSnapshot } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import { compareWork, retainWorkSnapshot } from '../src/features/work/utils/work-view';
import { fileToUpload } from '../src/features/attachments/utils/attachment-upload';

const work = (revision: number): WorkSnapshot => {
  return { state: { ...initialWorkState('branch'), revision }, checkpoints: [], compactions: [] };
};

describe('context and checkpoint presentation', () => {
  it('keeps the newer revision when a delayed refetch arrives after a write', () => {
    const current = work(4);
    expect(retainWorkSnapshot(current, work(3))).toBe(current);
    const checkpoint = {
      id: 'checkpoint',
      sessionId: 'session',
      branchId: 'branch',
      label: 'Saved',
      createdAt: 1,
      messageIds: [],
      state: current.state,
    };
    const withCheckpoint = { ...current, checkpoints: [checkpoint] };
    expect(retainWorkSnapshot(withCheckpoint, current)).toBe(withCheckpoint);
    const next = work(5);
    expect(retainWorkSnapshot(current, next)).toBe(next);
    const branch = { ...work(1), state: { ...work(1).state, branchId: 'other' } };
    expect(retainWorkSnapshot(current, branch)).toBe(branch);
  });

  it('detects a different message prefix even when both checkpoints contain the same number of messages', () => {
    const left = { state: initialWorkState('branch'), messageIds: ['first', 'second'] };
    const right = {
      state: { ...initialWorkState('branch'), mode: 'plan' as const },
      messageIds: ['first', 'replacement'],
    };
    const rows = compareWork(left, right);
    expect(
      rows.find((row) => {
        return row.label === '历史消息';
      })?.changed,
    ).toBe(true);
    expect(
      rows.find((row) => {
        return row.label === '模式';
      })?.changed,
    ).toBe(true);
    expect(
      rows.find((row) => {
        return row.label === '任务';
      })?.changed,
    ).toBe(false);
  });
});

describe('attachment selection', () => {
  it('encodes UTF-8 text and derives a type for a source file without a browser MIME type', async () => {
    const file = new File(['你好，工作区'], 'agents.ts');
    const result = await fileToUpload(file, new AbortController().signal);
    expect(result.mediaType).toBe('text/plain');
    expect(
      new TextDecoder().decode(
        Uint8Array.from(atob(result.data), (character) => {
          return character.charCodeAt(0);
        }),
      ),
    ).toBe('你好，工作区');
  });

  it('rejects oversized files and cancelled selection before uploading content', async () => {
    await expect(
      fileToUpload(
        new File([new Uint8Array(256_001)], 'large.txt', { type: 'text/plain' }),
        new AbortController().signal,
      ),
    ).rejects.toThrow('大小限制');
    const controller = new AbortController();
    controller.abort();
    await expect(
      fileToUpload(new File(['cancelled'], 'text.txt'), controller.signal),
    ).rejects.toThrow();
  });
});
