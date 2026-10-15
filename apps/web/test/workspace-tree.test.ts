import type { SessionSummary, Workspace } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceGroups,
  formatSessionCreatedAt,
} from '../src/features/workspaces/utils/workspace-tree';

const workspace: Workspace = {
  id: 'workspace',
  name: 'Project',
  icon: 'folder',
  rootPath: '/tmp/project',
  revision: 1,
  createdAt: 0,
  updatedAt: 0,
};
const session = (id: string, workspaceId: string | null, createdAt: number): SessionSummary => {
  return {
    id,
    workspaceId,
    createdAt,
    updatedAt: 99999999,
    title: id,
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    approvalMode: 'ask',
    activeBranchId: 'branch',
    activeRunId: null,
    snapshotSeq: 0,
  };
};

describe('workspace conversation navigation', () => {
  it('keeps legacy and unavailable-directory history visible once, sorted by creation', () => {
    const sessions = [
      session('older', 'workspace', 2),
      session('legacy', null, 1),
      session('newer', 'workspace', 3),
      session('missing', 'removed', 4),
    ];
    const groups = buildWorkspaceGroups([workspace], sessions);
    expect(
      groups.map((group) => {
        return [
          group.name,
          group.sessions.map((item) => {
            return item.id;
          }),
        ];
      }),
    ).toEqual([
      ['Project', ['newer', 'older']],
      ['未分配工作区', ['missing', 'legacy']],
    ]);
    expect(sessions[0]?.id).toBe('older');
  });

  it('shows new empty folders and derives compact creation time with future-clock tolerance', () => {
    expect(buildWorkspaceGroups([workspace], [])[0]?.sessions).toEqual([]);
    expect(formatSessionCreatedAt(120000, 60000)).toBe('刚刚');
    expect(formatSessionCreatedAt(0, 180000)).toBe('3分钟前');
    expect(formatSessionCreatedAt(0, 7200000)).toBe('2小时前');
  });
});
