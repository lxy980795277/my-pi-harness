import type {
  SearchHit,
  SearchQueryInput,
  SearchSourceSelection,
  SearchSourceExcerpt,
  Workspace,
} from '@my-pi-harness/protocol';
import type { SearchFilters, SourceWorkspaceView } from '@/features/search/types/search';
import type { SelectOption } from '@/components/ui/select-field';

export const SEARCH_KINDS: readonly SelectOption[] = [
  { value: 'message', label: '对话历史' },
  { value: 'memory', label: '长期记忆' },
];
export const SEARCH_PERIODS: readonly SelectOption[] = [
  { value: 'all', label: '所有时间' },
  { value: 'week', label: '最近 7 天' },
  { value: 'month', label: '最近 30 天' },
  { value: 'year', label: '最近一年' },
];
const PERIOD_DAYS = { week: 7, month: 30, year: 365 } as const;
const ORIGIN_LABELS: Record<SearchHit['origin'], string> = {
  memory: '记忆',
  user: '用户消息',
  assistant: 'Agent 回答',
  task: '子任务',
  communication: '任务通信',
};

/** Time and scope are frozen when the human submits; changing filters cannot relabel older results. */
export const searchInput = (
  filters: SearchFilters,
  workspaceId: string | null,
  sessionId: string | null,
  now: number,
): SearchQueryInput => {
  const query = filters.query.trim();
  if (query.length === 0 || query.length > 500) throw new Error('请填写 1–500 字符的搜索内容。');
  const scope: NonNullable<SearchQueryInput['scope']> = {
    kind: filters.kind,
    includeArchived: filters.archived,
    includeHistoricalBranches: filters.historical,
    includeTasks: filters.tasks,
  };
  if (filters.workspace === 'all') scope.allWorkspaces = true;
  else if (filters.workspace === 'current') scope.workspaceId = workspaceId;
  else if (filters.workspace === 'unassigned') scope.workspaceId = null;
  else scope.workspaceId = filters.workspace;
  if (filters.kind === 'memory') scope.includeUserMemories = filters.userMemories;
  if (filters.period !== 'all') {
    scope.createdFrom = now - PERIOD_DAYS[filters.period] * 86_400_000;
    scope.createdTo = now;
  }
  if (filters.branchId !== 'visible' && filters.kind === 'message') {
    if (sessionId === null) throw new Error('当前会话已变化，请重新选择分支。');
    scope.sessionId = sessionId;
    scope.branchId = filters.branchId;
    scope.includeHistoricalBranches = true;
  }
  return { query, scope, limit: 30 };
};

/** A hit must name one exact membership; text similarity is never used to invent a missing locator. */
export const selectionFromHit = (hit: SearchHit): SearchSourceSelection => {
  if (hit.end <= hit.start) throw new Error('搜索结果的原文范围无效。');
  if (hit.source.kind === 'memory') {
    if (hit.memoryId === undefined) throw new Error('搜索结果缺少记忆来源。');
    return {
      source: hit.source,
      target: { kind: 'memory', memoryId: hit.memoryId },
      start: hit.start,
      end: hit.end,
    };
  }
  if (hit.sessionId === undefined || hit.branchId === undefined || hit.messageId === undefined)
    throw new Error('搜索结果缺少准确消息位置。');
  const target: Extract<SearchSourceSelection['target'], { kind: 'message' }> = {
    kind: 'message',
    sessionId: hit.sessionId,
    branchId: hit.branchId,
    messageId: hit.messageId,
  };
  if (hit.taskId !== undefined) target.taskId = hit.taskId;
  return { source: hit.source, target, start: hit.start, end: hit.end };
};

export const searchOriginLabel = (origin: SearchHit['origin']): string => {
  return ORIGIN_LABELS[origin];
};

/** Root origins already name their role; child-task and communication origins need the extra role. */
export const sourceOriginLabel = (
  excerpt: Pick<SearchSourceExcerpt, 'origin' | 'role'>,
): string => {
  const label = searchOriginLabel(excerpt.origin);
  if (excerpt.origin !== 'task' && excerpt.origin !== 'communication') return label;
  if (excerpt.role === 'user') return `${label} · 用户`;
  if (excerpt.role === 'assistant') return `${label} · Agent`;
  return label;
};

/** Known workspace names come from the shared catalog; historical ids stay in an optional detail. */
export const sourceWorkspaceView = (
  workspaceId: string | null,
  workspaces: readonly Pick<Workspace, 'id' | 'name'>[],
): SourceWorkspaceView => {
  if (workspaceId === null) return { label: '未分配工作区', detailId: null };
  const workspace = workspaces.find((entry) => {
    return entry.id === workspaceId;
  });
  if (workspace !== undefined) return { label: workspace.name, detailId: null };
  return { label: '历史工作区', detailId: workspaceId };
};

/** The complete identity includes membership and range, so equal text in different sources stays distinct. */
export const sourceSelectionKey = (selection: SearchSourceSelection): string => {
  const target = selection.target;
  let parts: (string | number | undefined)[] = [target.kind];
  if (target.kind === 'memory') parts = [...parts, target.memoryId];
  else parts = [...parts, target.sessionId, target.branchId, target.messageId, target.taskId];
  return JSON.stringify([
    selection.source.id,
    selection.source.kind,
    selection.source.contentHash,
    ...parts,
    selection.start,
    selection.end,
  ]);
};
