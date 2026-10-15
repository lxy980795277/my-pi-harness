import type { WorkPatch, WorkState } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { Textarea } from '@/components/ui/textarea';
import { TodoRow } from '@/features/work/components/todo-row';
import { usePlanPanel } from '@/features/work/hooks/use-plan-panel';
import { PLAN_STATUS_LABELS, WORK_MODE_OPTIONS } from '@/features/work/utils/work-view';

interface PlanPanelProps {
  state: WorkState;
  running: boolean;
  onPatch: (input: WorkPatch) => Promise<void>;
}
/** Plan approval changes future-run policy and never starts execution implicitly. */
export const PlanPanel: FC<PlanPanelProps> = ({ state, running, onPatch }) => {
  const editor = usePlanPanel(state, onPatch);
  const disabled = running || editor.action.pending;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="work-mode">工作模式</Label>
        <SelectField
          id="work-mode"
          ariaLabel="工作模式"
          value={state.mode}
          options={WORK_MODE_OPTIONS}
          onValueChange={editor.mode}
          disabled={disabled}
          className="w-44"
        />
      </div>
      {state.mode === 'plan' && (
        <Notice>Plan 模式仅允许读取和会话规划；确认计划后仍需按执行批准方式授权。</Notice>
      )}
      {editor.action.error && <Notice tone="error">{editor.action.error}</Notice>}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">计划</span>
        <Button type="button" variant="outline" disabled={disabled} onClick={editor.start}>
          编辑计划
        </Button>
      </div>
      {!editor.editing && state.plan && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{state.plan.title}</span>
            <Badge>{PLAN_STATUS_LABELS[state.plan.status]}</Badge>
          </div>
          <div className="text-sm leading-7 break-words whitespace-pre-wrap">
            {state.plan.content}
          </div>
          <div className="flex gap-2">
            {state.plan.status === 'draft' && (
              <Button type="button" disabled={disabled} onClick={editor.approve}>
                批准计划并切换执行
              </Button>
            )}
            {state.plan.status === 'approved' && (
              <Button type="button" variant="outline" disabled={disabled} onClick={editor.complete}>
                标记计划完成
              </Button>
            )}
          </div>
        </div>
      )}
      {!editor.editing && !state.plan && (
        <div className="text-xs text-muted-foreground">暂无计划，可自行添加或请 Agent 制定。</div>
      )}
      {editor.editing && (
        <form className="space-y-3 rounded-xl border border-border p-4" onSubmit={editor.save}>
          <div className="space-y-1">
            <Label htmlFor="plan-title">计划标题</Label>
            <Input
              id="plan-title"
              value={editor.title}
              onChange={editor.changeTitle}
              maxLength={200}
              disabled={disabled}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="plan-content">计划内容</Label>
            <Textarea
              id="plan-content"
              value={editor.content}
              onChange={editor.changeContent}
              maxLength={32000}
              className="min-h-40"
              disabled={disabled}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={editor.cancel}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={disabled || !editor.title.trim() || !editor.content.trim()}
            >
              保存计划
            </Button>
          </div>
        </form>
      )}
      <div className="space-y-3">
        <span className="text-sm font-medium">任务</span>
        {state.todos.map((todo) => {
          return (
            <TodoRow
              key={todo.id}
              todo={todo}
              disabled={disabled}
              onSave={editor.saveTodo}
              onRemove={editor.removeTodo}
            />
          );
        })}
        {state.todos.length === 0 && <div className="text-xs text-muted-foreground">暂无任务</div>}
        <form className="flex gap-2" onSubmit={editor.addTodo}>
          <Input
            value={editor.newTodo}
            onChange={editor.changeTodo}
            placeholder="添加任务"
            maxLength={1000}
            disabled={disabled || state.todos.length >= 100}
            aria-label="新任务"
          />
          <Button
            type="submit"
            disabled={disabled || !editor.newTodo.trim() || state.todos.length >= 100}
          >
            添加
          </Button>
        </form>
      </div>
    </div>
  );
};
