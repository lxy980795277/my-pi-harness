import type { SessionSummary, Workspace } from '@my-pi-harness/protocol';

export interface WorkspaceGroup {
  id: string;
  workspace: Workspace | null;
  name: string;
  sessions: SessionSummary[];
}

/** Groups every saved conversation exactly once, including pre-workspace history. */
export const buildWorkspaceGroups = (
  workspaces: readonly Workspace[],
  sessions: readonly SessionSummary[],
): WorkspaceGroup[] => {
  const groups: WorkspaceGroup[] = workspaces.map((workspace) => {
    return { id: workspace.id, workspace, name: workspace.name, sessions: [] };
  });
  const byId = new Map(
    groups.map((group) => {
      return [group.id, group];
    }),
  );
  const unassigned: SessionSummary[] = [];
  for (const session of sessions) {
    const group = session.workspaceId && byId.get(session.workspaceId);
    if (group) {
      group.sessions.push(session);
    } else {
      unassigned.push(session);
    }
  }
  if (unassigned.length > 0) {
    groups.push({ id: 'unassigned', workspace: null, name: '未分配工作区', sessions: unassigned });
  }
  for (const group of groups) {
    group.sessions.sort((first, second) => {
      return second.createdAt - first.createdAt;
    });
  }
  return groups;
};

/** Conversation rows show creation time rather than the latest streamed activity. */
export const formatSessionCreatedAt = (createdAt: number, now: number): string => {
  const elapsed = Math.max(0, now - createdAt);
  if (elapsed < 60_000) {
    return '刚刚';
  }
  if (elapsed < 3_600_000) {
    return `${Math.floor(elapsed / 60_000)}分钟前`;
  }
  if (elapsed < 86_400_000) {
    return `${Math.floor(elapsed / 3_600_000)}小时前`;
  }
  const date = new Date(createdAt);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
};

/** Full timestamps remain available independently of the compact sidebar label. */
export const describeSessionCreatedAt = (createdAt: number): string => {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(createdAt);
};
