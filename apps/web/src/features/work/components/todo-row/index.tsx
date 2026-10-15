import type { Todo } from '@my-pi-harness/protocol';
import { Pencil, Trash2 } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { useTodoRow } from '@/features/work/hooks/use-todo-row';
import { TODO_STATUS_OPTIONS } from '@/features/work/utils/work-view';

interface TodoRowProps {
  todo: Todo;
  disabled: boolean;
  onSave: (todo: Todo) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}
/** A compact task row supports title edits, state changes and removal. */
export const TodoRow: FC<TodoRowProps> = ({ todo, disabled, onSave, onRemove }) => {
  const state = useTodoRow(todo, onSave, onRemove);
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-center gap-2">
        {!state.editing && <span className="min-w-0 flex-1 text-sm break-words">{todo.title}</span>}
        {state.editing && (
          <Input
            value={state.title}
            onChange={state.change}
            maxLength={1000}
            disabled={state.action.pending}
            aria-label={`任务名称 ${todo.title}`}
          />
        )}
        <SelectField
          id={`todo-status-${todo.id}`}
          ariaLabel={`任务状态 ${todo.title}`}
          value={todo.status}
          options={TODO_STATUS_OPTIONS}
          onValueChange={state.status}
          disabled={disabled || state.action.pending}
          className="h-8 w-28 shrink-0 text-xs"
        />
        {!state.editing && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={disabled || state.action.pending}
            onClick={state.start}
            aria-label={`编辑任务 ${todo.title}`}
          >
            <Pencil width={14} height={14} aria-hidden />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={disabled || state.action.pending}
          onClick={state.remove}
          aria-label={`删除任务 ${todo.title}`}
        >
          <Trash2 width={14} height={14} aria-hidden />
        </Button>
      </div>
      {state.editing && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={state.cancel}>
            取消
          </Button>
          <Button
            type="button"
            disabled={disabled || state.action.pending || !state.title.trim()}
            onClick={state.save}
          >
            保存
          </Button>
        </div>
      )}
      {state.action.error && <Notice tone="error">{state.action.error}</Notice>}
    </div>
  );
};
