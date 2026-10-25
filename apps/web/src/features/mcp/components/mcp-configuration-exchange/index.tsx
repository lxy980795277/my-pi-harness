import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Notice } from '@/components/ui/notice';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { useMcpConfigurationExchange } from '@/features/mcp/hooks/use-mcp-configuration-exchange';

/** Export contains public configuration only; import never carries secrets or trust. */
export const McpConfigurationExchange: FC = () => {
  const state = useMcpConfigurationExchange();
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button variant="outline" onClick={state.show}>
          导入JSON配置
        </Button>
        <Button variant="ghost" onClick={state.download} disabled={state.pending}>
          导出脱敏配置
        </Button>
      </div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <Dialog open={state.open} onOpenChange={state.changeOpen}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-auto" closeLabel="关闭MCP配置导入">
          <DialogTitle>导入 MCP 配置</DialogTitle>
          <DialogDescription>
            粘贴 version=1、local 和 remote 数组。导入前先检查名称及字段，所有新项保持停用。
          </DialogDescription>
          <Textarea
            aria-label="导入MCP配置JSON"
            value={state.encoded}
            onChange={state.change}
            className="min-h-56 font-mono text-xs"
          />
          {state.summary && (
            <pre className="text-xs whitespace-pre-wrap text-muted-foreground">{state.summary}</pre>
          )}
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={state.inspect} disabled={state.pending}>
              预览导入
            </Button>
            <Button onClick={state.save} disabled={state.pending || state.preview === null}>
              确认批量导入
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
