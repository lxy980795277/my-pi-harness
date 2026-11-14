import type { FileChangeBatchInput } from '@my-pi-harness/protocol';
import { Redo2, Undo2 } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import type { FileChangeScope } from '@/features/file-changes/stores/file-changes';

interface FileChangeActionsProps {
  scope: FileChangeScope;
  selectedIds: string[];
  blocked: boolean;
  onOperate: (
    action: FileChangeBatchInput['action'],
    selection: FileChangeBatchInput['selection'],
  ) => void;
}

/** A whole-answer operation sends the root input ID, independent of mounted list pages. */
export const FileChangeActions: FC<FileChangeActionsProps> = ({
  scope,
  selectedIds,
  blocked,
  onOperate,
}) => {
  const undoSelected = (): void => {
    onOperate('undo', { kind: 'changes', changeIds: selectedIds });
  };
  const redoSelected = (): void => {
    onOperate('redo', { kind: 'changes', changeIds: selectedIds });
  };
  const undoAnswer = (): void => {
    if (scope.inputMessageId !== undefined)
      onOperate('undo', { kind: 'answer', inputMessageId: scope.inputMessageId });
  };
  const redoAnswer = (): void => {
    if (scope.inputMessageId !== undefined)
      onOperate('redo', { kind: 'answer', inputMessageId: scope.inputMessageId });
  };
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
      {scope.inputMessageId !== undefined && <span>本次回答 · 含子任务</span>}
      {scope.toolCallId !== undefined && <span>当前工具调用</span>}
      {scope.inputMessageId === undefined && scope.toolCallId === undefined && (
        <span>当前会话 · 全部分支</span>
      )}
      <span className="mr-auto">已选 {selectedIds.length} / 50 项</span>
      <Button
        type="button"
        variant="ghost"
        className="h-7 gap-1 px-2 text-xs"
        onClick={undoSelected}
        disabled={blocked || selectedIds.length === 0}
      >
        <Undo2 width={13} height={13} aria-hidden />
        撤销所选
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="h-7 gap-1 px-2 text-xs"
        onClick={redoSelected}
        disabled={blocked || selectedIds.length === 0}
      >
        <Redo2 width={13} height={13} aria-hidden />
        重做所选
      </Button>
      {scope.inputMessageId !== undefined && (
        <Button
          type="button"
          variant="outline"
          className="h-7 text-xs"
          onClick={undoAnswer}
          disabled={blocked}
        >
          撤销本次回答
        </Button>
      )}
      {scope.inputMessageId !== undefined && (
        <Button
          type="button"
          variant="outline"
          className="h-7 text-xs"
          onClick={redoAnswer}
          disabled={blocked}
        >
          重做本次回答
        </Button>
      )}
    </div>
  );
};
