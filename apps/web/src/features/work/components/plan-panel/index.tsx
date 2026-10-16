import type { ToolCallView, WorkPatch, WorkState } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { PlanSteps } from '@/features/work/components/plan-steps';
import { TodoRow } from '@/features/work/components/todo-row';
import { usePlanPanel } from '@/features/work/hooks/use-plan-panel';
import { PLAN_STATUS_LABELS, WORK_MODE_OPTIONS } from '@/features/work/utils/work-view';
interface PlanPanelProps {
  state: WorkState;
  running: boolean;
  tools: ToolCallView[];
  onPatch: (input: WorkPatch) => Promise<void>;
}
/** Plans reflect reviewed model proposals; manual Todo edits remain available while idle. */
export const PlanPanel: FC<PlanPanelProps> = ({ state, running, tools, onPatch }) => {
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
      {editor.action.error && <Notice tone="error">{editor.action.error}</Notice>}
      {state.plan && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{state.plan.title}</span>
            <Badge>{PLAN_STATUS_LABELS[state.plan.status]}</Badge>
          </div>
          <div className="text-sm leading-7 break-words whitespace-pre-wrap">
            {state.plan.content}
          </div>
          <PlanSteps steps={state.plan.steps} />
          {state.plan.feedback && (
            <div className="text-xs text-muted-foreground">修改意见：{state.plan.feedback}</div>
          )}
        </div>
      )}
      {!state.plan && <div className="text-xs text-muted-foreground">暂无计划</div>}
      <div className="space-y-3">
        <span className="text-sm font-medium">任务</span>
        {state.todos.map((todo) => {
          return (
            <TodoRow
              key={todo.id}
              todo={todo}
              tools={tools}
              steps={state.plan?.steps ?? []}
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
