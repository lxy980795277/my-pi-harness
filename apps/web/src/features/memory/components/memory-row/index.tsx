import type { MemoryEntry } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Switch } from '@/components/ui/switch';
import { useMemoryRow } from '@/features/memory/hooks/use-memory-row';
import {
  memoryCategoryLabel,
  memoryModeLabel,
  memorySourceLabel,
} from '@/features/memory/utils/memory-view';

interface MemoryRowProps {
  entry: MemoryEntry;
  onEdit: (entry: MemoryEntry) => void;
  onChanged: () => void;
}

/** Each confirmed fact can be paused without losing its body, or explicitly forgotten. */
export const MemoryRow: FC<MemoryRowProps> = ({ entry, onEdit, onChanged }) => {
  const state = useMemoryRow(entry, onEdit, onChanged);
  return (
    <article className="space-y-3 rounded-2xl border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{memoryCategoryLabel(entry.category)}</span>
          <span>·</span>
          <span>{memoryModeLabel(entry.mode)}</span>
          <span>·</span>
          <span>{memorySourceLabel(entry.source)}</span>
        </div>
        <Switch
          checked={entry.enabled}
          onCheckedChange={state.changeEnabled}
          disabled={state.update.pending || state.forget.pending}
          aria-label="启用此条记忆"
        />
      </div>
      <p className="text-sm leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap">{entry.body}</p>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">修订 {entry.revision}</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={state.edit}
            disabled={state.update.pending || state.forget.pending}
          >
            <Pencil width={12} height={12} aria-hidden />
            编辑
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs text-error-foreground"
            onClick={state.openForget}
            disabled={state.update.pending || state.forget.pending}
          >
            <Trash2 width={12} height={12} aria-hidden />
            忘记
          </Button>
        </div>
      </div>
      {state.update.error && <Notice tone="error">{state.update.error}</Notice>}
      <ConfirmDialog
        open={state.forgetting}
        onOpenChange={state.changeForgetting}
        title="忘记这条记忆？"
        description="后续请求将不再使用它。已经发送的请求和历史回答仍保留当时的内容。"
        confirmLabel="忘记记忆"
        pending={state.forget.pending}
        error={state.forget.error}
        onConfirm={state.forget.run}
      />
    </article>
  );
};
