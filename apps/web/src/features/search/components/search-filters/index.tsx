import type { FC } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectField } from '@/components/ui/select-field';
import { Switch } from '@/components/ui/switch';
import type { SearchDialogState } from '@/features/search/types/search';
import { SEARCH_KINDS, SEARCH_PERIODS } from '@/features/search/utils/search';

interface SearchFiltersProps {
  state: SearchDialogState;
}

/** Extra workspaces, abandoned branches and child tasks require visible human choices. */
export const SearchFilters: FC<SearchFiltersProps> = ({ state }) => {
  return (
    <form onSubmit={state.submit} className="space-y-4">
      <div className="flex gap-2">
        <Label htmlFor="global-search-query" className="sr-only">
          搜索内容
        </Label>
        <Input
          id="global-search-query"
          value={state.filters.query}
          onChange={state.changeQuery}
          maxLength={500}
          placeholder="查找以前的讨论、偏好或项目事实"
        />
        <Button
          type="submit"
          className="gap-1.5"
          disabled={state.results.isFetching || state.filters.query.trim().length === 0}
        >
          <Search width={14} height={14} aria-hidden />
          搜索
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="global-search-kind">内容</Label>
          <SelectField
            id="global-search-kind"
            value={state.filters.kind}
            options={SEARCH_KINDS}
            onValueChange={state.changeKind}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="global-search-workspace">工作区</Label>
          <SelectField
            id="global-search-workspace"
            value={state.filters.workspace}
            options={state.workspaceOptions}
            onValueChange={state.changeWorkspace}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="global-search-time">时间</Label>
          <SelectField
            id="global-search-time"
            value={state.filters.period}
            options={SEARCH_PERIODS}
            onValueChange={state.changePeriod}
          />
        </div>
        {state.filters.kind === 'message' && state.activeSessionId !== null && (
          <div className="space-y-2">
            <Label htmlFor="global-search-branch">指定当前会话分支</Label>
            <SelectField
              id="global-search-branch"
              value={state.filters.branchId}
              options={state.branchOptions}
              onValueChange={state.changeBranch}
            />
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-3">
        {state.filters.kind === 'message' && (
          <>
            <div className="flex items-center gap-2">
              <Switch
                id="global-search-archived"
                checked={state.filters.archived}
                onCheckedChange={state.changeArchived}
              />
              <Label htmlFor="global-search-archived">包含归档会话</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="global-search-history"
                checked={state.filters.historical}
                onCheckedChange={state.changeHistorical}
              />
              <Label htmlFor="global-search-history">包含历史分支</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="global-search-tasks"
                checked={state.filters.tasks}
                onCheckedChange={state.changeTasks}
              />
              <Label htmlFor="global-search-tasks">包含子任务</Label>
            </div>
          </>
        )}
        {state.filters.kind === 'memory' && (
          <div className="flex items-center gap-2">
            <Switch
              id="global-search-user"
              checked={state.filters.userMemories}
              onCheckedChange={state.changeUserMemories}
            />
            <Label htmlFor="global-search-user">包含个人记忆</Label>
          </div>
        )}
      </div>
    </form>
  );
};
