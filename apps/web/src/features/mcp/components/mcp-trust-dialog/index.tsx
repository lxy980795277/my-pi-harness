import type { FC } from 'react';
import type { McpTrustPreview } from '@my-pi-harness/protocol';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';

interface McpTrustDialogProps {
  preview: McpTrustPreview;
  pending: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}
/** Startup consent names the resolved executable, root and isolation; call approval remains separate. */
export const McpTrustDialog: FC<McpTrustDialogProps> = ({
  preview,
  pending,
  error,
  onOpenChange,
  onConfirm,
}) => {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-auto" closeLabel="取消启动授权">
        <DialogTitle>允许运行本机 MCP 程序？</DialogTitle>
        <DialogDescription>
          此授权允许在指定范围启动本机程序；工具调用仍遵循输入框的审批策略。
        </DialogDescription>
        <dl className="space-y-3 text-xs leading-6 [overflow-wrap:anywhere]">
          <div>
            <dt className="text-muted-foreground">程序</dt>
            <dd className="font-mono">{preview.command}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">参数</dt>
            <dd className="font-mono whitespace-pre-wrap">
              {JSON.stringify(preview.args, null, 2)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">工作目录</dt>
            <dd>{preview.workspaceRoot}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">环境变量名称</dt>
            <dd>{preview.environmentNames.join('、') || '无'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">隔离与网络</dt>
            <dd>
              {preview.scope === 'sandboxed' && '受监管隔离 · 网络受限'}
              {preview.scope === 'full-access' && '完全访问权限 · 网络不受限'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">启动指纹</dt>
            <dd className="font-mono">{preview.startupFingerprint}</dd>
          </div>
        </dl>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="button" onClick={onConfirm} disabled={pending}>
          确认授权并启用
        </Button>
      </DialogContent>
    </Dialog>
  );
};
