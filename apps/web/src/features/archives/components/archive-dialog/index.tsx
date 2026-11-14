import { ArrowLeft, History } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { ArchiveBinding } from '@/features/archives/components/archive-binding';
import { ArchiveHistory } from '@/features/archives/components/archive-history';
import { ArchiveTransfer } from '@/features/archives/components/archive-transfer';
import { useArchiveTransfer } from '@/features/archives/hooks/use-archive-transfer';
import { useArchiveStore } from '@/features/archives/stores/archives';

interface ArchiveDialogProps {
  mode: 'import' | 'export' | 'bind' | 'history';
  sessionId: string | null;
}

const TITLES = {
  import: '导入会话归档',
  export: '导出完整归档',
  bind: '配置当前执行依赖',
  history: '归档操作历史',
};

/** One global modal serves archive transport, durable results and explicit execution binding. */
export const ArchiveDialog: FC<ArchiveDialogProps> = ({ mode, sessionId }) => {
  const state = useArchiveTransfer();
  const history = useArchiveStore((store) => {
    return store.history;
  });
  const back = useArchiveStore((store) => {
    return store.startNew;
  });
  return (
    <Dialog open onOpenChange={state.changeOpen}>
      <DialogContent
        className="flex max-h-[calc(100svh-32px)] w-[calc(100vw-32px)] max-w-2xl flex-col gap-0 overflow-hidden p-0"
        closeLabel="关闭会话归档"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4 pr-14">
          <div className="min-w-0 space-y-1">
            <DialogTitle>{TITLES[mode]}</DialogTitle>
            <DialogDescription className="text-xs">
              完整资源归档与本机执行权限分开管理。
            </DialogDescription>
          </div>
          {mode !== 'history' && (
            <Button
              type="button"
              variant="ghost"
              className="h-8 gap-1 px-2 text-xs"
              onClick={history}
            >
              <History width={14} height={14} aria-hidden />
              操作历史
            </Button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {mode === 'bind' && sessionId !== null && <ArchiveBinding sessionId={sessionId} />}
          {mode === 'history' && state.operationId === null && <ArchiveHistory />}
          {mode === 'history' && state.operationId !== null && (
            <div className="mb-4">
              <Button
                type="button"
                variant="ghost"
                className="h-8 gap-1 px-2 text-xs"
                onClick={back}
              >
                <ArrowLeft width={14} height={14} aria-hidden />
                返回操作历史
              </Button>
            </div>
          )}
          {mode !== 'bind' && (mode !== 'history' || state.operationId !== null) && (
            <ArchiveTransfer mode={mode} state={state} />
          )}
        </div>
        <footer className="shrink-0 border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
          关闭时尝试取消尚未发布的传输；发布开始后按原操作 ID 查询，不会自动重试。
          {state.closing && <span role="status">正在清理未发布任务…</span>}
        </footer>
      </DialogContent>
    </Dialog>
  );
};
