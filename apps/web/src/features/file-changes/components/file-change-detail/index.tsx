import type { FileChangeBatchInput } from '@my-pi-harness/protocol';
import { ArrowLeft, ChevronLeft, ChevronRight, Redo2, Undo2 } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Tabs } from '@/components/ui/tabs';
import { TabsList } from '@/components/ui/tabs/tabs-list';
import { TabsTrigger } from '@/components/ui/tabs/tabs-trigger';
import { useFileChangeDetail } from '@/features/file-changes/hooks/use-file-change-detail';
import {
  fileChangeImageLabel,
  fileChangeStateLabel,
} from '@/features/file-changes/utils/file-change-view';
import { describeError } from '@/utils/describe-error';

interface FileChangeDetailProps {
  sessionId: string;
  changeId: string;
  blocked: boolean;
  onBack: () => void;
  onOperate: (
    action: FileChangeBatchInput['action'],
    selection: FileChangeBatchInput['selection'],
  ) => void;
}

/** Raw text snapshots remain readable without executing Markdown, HTML or patch commands. */
export const FileChangeDetail: FC<FileChangeDetailProps> = ({
  sessionId,
  changeId,
  blocked,
  onBack,
  onOperate,
}) => {
  const state = useFileChangeDetail(sessionId, changeId);
  const undo = (): void => {
    onOperate('undo', { kind: 'changes', changeIds: [changeId] });
  };
  const redo = (): void => {
    onOperate('redo', { kind: 'changes', changeIds: [changeId] });
  };
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="文件变更详情">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 lg:hidden"
          onClick={onBack}
          aria-label="返回文件变更列表"
        >
          <ArrowLeft width={15} height={15} aria-hidden />
        </Button>
        <p
          className="min-w-0 flex-1 truncate text-xs font-medium"
          title={state.query.data?.change.path}
        >
          {state.query.data?.change.path ?? '文件变更'}
        </p>
        <Button
          type="button"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={undo}
          disabled={blocked || state.query.data?.change.undoAvailable !== true}
        >
          <Undo2 width={13} height={13} aria-hidden />
          撤销
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={redo}
          disabled={blocked || state.query.data?.change.redoAvailable !== true}
        >
          <Redo2 width={13} height={13} aria-hidden />
          重做
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <Tabs value={state.side} onValueChange={state.changeSide}>
          <TabsList aria-label="文件快照内容">
            <TabsTrigger value="diff">差异</TabsTrigger>
            <TabsTrigger value="before">修改前</TabsTrigger>
            <TabsTrigger value="after">修改后</TabsTrigger>
          </TabsList>
        </Tabs>
        {state.query.isPending && (
          <p className="text-xs text-muted-foreground" role="status">
            正在读取文件快照…
          </p>
        )}
        {state.query.isError && <Notice tone="error">{describeError(state.query.error)}</Notice>}
        {state.query.data && (
          <div className="space-y-4">
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>{fileChangeStateLabel(state.query.data.change)}</p>
              <p>修改前 · {fileChangeImageLabel(state.query.data.change.before)}</p>
              <p>修改后 · {fileChangeImageLabel(state.query.data.change.after)}</p>
              {state.query.data.change.blockedReason !== null && (
                <p>{state.query.data.change.blockedReason}</p>
              )}
            </div>
            <pre className="min-w-0 rounded-lg bg-muted/50 p-4 font-mono text-xs leading-5 [overflow-wrap:anywhere] whitespace-pre-wrap">
              {state.query.data.text}
            </pre>
          </div>
        )}
      </div>
      <footer className="flex shrink-0 items-center justify-between border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
        <span>每段最多 60 KiB</span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={state.previous}
            disabled={state.offset === 0 || state.query.isFetching}
          >
            <ChevronLeft width={13} height={13} aria-hidden />
            上一段
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={state.next}
            disabled={state.query.data?.nextOffset == null || state.query.isFetching}
          >
            下一段
            <ChevronRight width={13} height={13} aria-hidden />
          </Button>
        </div>
      </footer>
    </section>
  );
};
