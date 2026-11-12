import type { FC } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { MemoryRow } from '@/features/memory/components/memory-row';
import type { MemoryPanelState } from '@/features/memory/types/memory';
import {
  MEMORY_CATEGORY_FILTERS,
  MEMORY_MANAGER_VIEWS,
  MEMORY_MODE_FILTERS,
  memoryProfileGroups,
} from '@/features/memory/utils/memory-view';

interface MemoryManagerProps {
  state: MemoryPanelState;
}

/** Management and profiles share scoped pagination; profiles never summarize only a hidden first page. */
export const MemoryManager: FC<MemoryManagerProps> = ({ state }) => {
  const groups = memoryProfileGroups(state.entries.data?.items ?? []);
  return (
    <section className="space-y-4" aria-label="记忆管理与画像">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="memory-manager-view">查看</Label>
            <SelectField
              id="memory-manager-view"
              value={state.view}
              options={MEMORY_MANAGER_VIEWS}
              onValueChange={state.changeView}
            />
          </div>
          <div className="min-w-0 space-y-2">
            <Label htmlFor="memory-list-scope">记忆范围</Label>
            <SelectField
              id="memory-list-scope"
              value={state.scopeValue}
              options={state.scopeOptions}
              onValueChange={state.changeScope}
              disabled={state.workspacePending}
              className="min-w-52"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="memory-list-mode">采用方式</Label>
            <SelectField
              id="memory-list-mode"
              value={state.modeFilter}
              options={MEMORY_MODE_FILTERS}
              onValueChange={state.changeModeFilter}
              className="w-36"
            />
          </div>
          {state.view === 'profile' && (
            <div className="space-y-2">
              <Label htmlFor="memory-profile-category">画像类型</Label>
              <SelectField
                id="memory-profile-category"
                value={state.profileCategory}
                options={MEMORY_CATEGORY_FILTERS}
                onValueChange={state.changeProfileCategory}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={state.refresh.run}
            disabled={state.refresh.pending}
            aria-label="刷新记忆列表"
            title="刷新列表"
          >
            <RefreshCw width={14} height={14} aria-hidden />
          </Button>
          <Button
            type="button"
            className="gap-1.5"
            onClick={state.create}
            disabled={state.workspacePending || state.workspaceError !== null}
          >
            <Plus width={14} height={14} aria-hidden />
            添加记忆
          </Button>
        </div>
      </div>
      {state.view === 'profile' && (
        <p className="text-xs leading-5 text-muted-foreground">
          画像按当前有效记忆分组，不另存摘要。以下仅为当前页，可翻页查看其他条目；编辑入口直接对应原记忆。
        </p>
      )}
      {state.entries.isPending && <Notice>正在读取记忆…</Notice>}
      {state.entries.isError && <Notice tone="error">{state.entries.error.message}</Notice>}
      {state.refresh.error && <Notice tone="error">{state.refresh.error}</Notice>}
      {!state.entries.isError && state.entries.data?.items.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground/70">这个范围内暂无记忆</p>
      )}
      {!state.entries.isError && state.view === 'entries' && (
        <div className="space-y-3">
          {state.entries.data?.items.map((entry) => {
            return (
              <MemoryRow
                key={entry.id}
                entry={entry}
                onEdit={state.edit}
                onChanged={state.resetPage}
              />
            );
          })}
        </div>
      )}
      {!state.entries.isError &&
        state.view === 'profile' &&
        groups.map((group) => {
          return (
            <div key={group.category} className="space-y-3">
              <h3 className="text-sm font-medium">
                {group.label} · 本页 {group.entries.length} 条
              </h3>
              {group.entries.map((entry) => {
                return (
                  <MemoryRow
                    key={entry.id}
                    entry={entry}
                    onEdit={state.edit}
                    onChanged={state.resetPage}
                  />
                );
              })}
            </div>
          );
        })}
      {state.entries.data && !state.entries.isError && (
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            {state.pageLabel} · 共 {state.entries.data.total} 条
          </span>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              className="h-8 text-xs"
              disabled={!state.hasPrevious || state.entries.isFetching}
              onClick={state.previous}
            >
              上一页
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-8 text-xs"
              disabled={!state.hasNext || state.entries.isFetching}
              onClick={state.next}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </section>
  );
};
