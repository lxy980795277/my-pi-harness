import type { MemoryEntry } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import {
  memoryChangeLabel,
  memoryModeLabel,
  memoryOmissionLabel,
  memorySelectionLabel,
  memoryScopeOptions,
  memoryProfileGroups,
  resolveMemoryScope,
} from '../src/features/memory/utils/memory-view';
import { memoryPageCursors, memoryPageKey } from '../src/features/memory/utils/memory-pagination';

const ENTRY: MemoryEntry = {
  id: 'memory',
  scope: { kind: 'user' },
  category: 'fact',
  body: '当时的事实',
  revision: 1,
  enabled: true,
  mode: 'fixed',
  source: { kind: 'manual' },
  createdAt: 1,
  updatedAt: 1,
};

describe('memory presentation ownership', () => {
  it('does not turn a stale workspace selection into user scope', () => {
    expect(resolveMemoryScope('user', 'workspace')).toEqual({ kind: 'user' });
    expect(resolveMemoryScope('workspace:workspace', 'workspace')).toEqual({
      kind: 'workspace',
      workspaceId: 'workspace',
    });
    expect(() => resolveMemoryScope('workspace:previous', 'workspace')).toThrow('范围已变化');
    expect(memoryScopeOptions(null, null)).toEqual([{ value: 'user', label: '当前用户' }]);
  });

  it('distinguishes an unread current state from an explicitly forgotten fact', () => {
    expect(memoryChangeLabel(ENTRY, undefined, false, true)).toContain('核对');
    expect(memoryChangeLabel(ENTRY, undefined, true, true)).toContain('无法读取');
    expect(
      memoryChangeLabel(
        ENTRY,
        { id: ENTRY.id, revision: null, enabled: false, mode: null },
        false,
        true,
      ),
    ).toBe('当前已忘记');
  });

  it('annotates later edits and controls without changing the historical body', () => {
    const current = { ...ENTRY, body: '现在的事实', revision: 2, enabled: false };
    expect(memoryChangeLabel(ENTRY, current, false, false)).toBe(
      '当前已修改 · 修订 2；当前已停用；当前已关闭记忆使用',
    );
    expect(ENTRY.body).toBe('当时的事实');
    expect(memoryChangeLabel(ENTRY, ENTRY, false, true)).toBe('与当前记忆一致');
  });

  it('keeps snapshot mode independent of a later switch to relevant recall', () => {
    expect(memoryModeLabel(undefined)).toBe('固定采用');
    expect(memoryModeLabel('relevant')).toBe('相关时采用');
    expect(
      memoryChangeLabel(
        ENTRY,
        { id: ENTRY.id, revision: 2, enabled: true, mode: 'relevant' },
        false,
        true,
      ),
    ).toContain('当前已改为相关时采用');
    expect(ENTRY.mode).toBe('fixed');
    expect(memorySelectionLabel(undefined)).toContain('未记录');
    expect(memoryOmissionLabel('budget')).toBe('本次记忆额度不足');
    expect(memoryOmissionLabel('not-retrieved')).toBe('本次未检索到');
    expect(memoryOmissionLabel('below-threshold')).toBe('未达到相关性门槛');
  });

  it('does not reuse an old keyset cursor after scope or mode changes', () => {
    const key = memoryPageKey('workspace:first', 'all');
    const pagination = { key, cursors: [null, 'memory-20'] };
    expect(memoryPageCursors(pagination, key)).toEqual([null, 'memory-20']);
    expect(memoryPageCursors(pagination, memoryPageKey('workspace:second', 'all'))).toEqual([null]);
    expect(memoryPageCursors(pagination, memoryPageKey('workspace:first', 'relevant'))).toEqual([
      null,
    ]);
    expect(
      memoryPageCursors(pagination, memoryPageKey('workspace:first', 'all', 'profile', 'fact')),
    ).toEqual([null]);
  });

  it('derives profile groups from enabled original entries on the displayed page rather than a stored summary', () => {
    const preference = { ...ENTRY, id: 'preference', category: 'preference' as const };
    const groups = memoryProfileGroups([
      ENTRY,
      preference,
      { ...ENTRY, id: 'disabled', enabled: false },
    ]);
    expect(groups.map((group) => group.category)).toEqual(['preference', 'fact']);
    expect(groups.flatMap((group) => group.entries)).toEqual([preference, ENTRY]);
    expect(groups[1]?.entries[0]).toBe(ENTRY);
  });
});
