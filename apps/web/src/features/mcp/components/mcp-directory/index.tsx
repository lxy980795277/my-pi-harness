import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Notice } from '@/components/ui/notice';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { useMcpDirectory, type McpDirectoryProps } from '@/features/mcp/hooks/use-mcp-directory';

/** Resource and prompt entries are descriptive; no automatic reads or prompt execution occur. */
export const McpDirectory: FC<McpDirectoryProps> = (props) => {
  const state = useMcpDirectory(props);
  return (
    <div className="space-y-3">
      {state.hasCatalog && (
        <p className="text-xs text-muted-foreground">已发现 {state.rows.length} 个工具</p>
      )}
      <div className="space-y-2">
        {state.rows.map((row) => {
          return (
            <div
              key={row.tool.remoteToolName}
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <span className="min-w-0 flex-1 font-mono break-all">{row.tool.remoteToolName}</span>
              {!row.tool.available && (
                <span className="text-warning-solid">不可选 {row.tool.diagnostic}</span>
              )}
              <Button
                className="h-7 px-2 text-xs"
                variant="ghost"
                onClick={row.toggle}
                disabled={state.pending}
              >
                {row.tool.enabled === false && '启用'}
                {row.tool.enabled !== false && '停用'}
              </Button>
              <Button
                className="h-7 px-2 text-xs"
                variant="ghost"
                onClick={row.authorize}
                disabled={state.pending || !row.tool.available}
              >
                可信只读参数
              </Button>
            </div>
          );
        })}
      </div>
      {state.grantRows.map((row) => {
        return (
          <div key={row.grant.id} className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">
              只读授权 · {row.grant.remoteToolName} · 参数 {row.grant.argumentsHash.slice(0, 12)}
            </span>
            <Button
              className="h-7 px-2 text-xs"
              variant="ghost"
              onClick={row.revoke}
              disabled={state.pending}
            >
              撤销只读授权
            </Button>
          </div>
        );
      })}
      {state.metadata && (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            Resources {state.metadata.resources.length} · Prompts {state.metadata.prompts.length}
          </p>
          {state.metadata.resources.map((resource) => {
            return (
              <p className="break-all" key={resource.uri}>
                资源 · {resource.name} · {resource.uri}
              </p>
            );
          })}
          {state.metadata.prompts.map((prompt) => {
            return (
              <p key={prompt.name}>
                提示词 · {prompt.name} · {prompt.description}
              </p>
            );
          })}
        </div>
      )}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <Dialog open={state.tool !== null} onOpenChange={state.close}>
        <DialogContent closeLabel="关闭可信只读授权">
          <DialogTitle>确认可信只读参数</DialogTitle>
          <DialogDescription>
            你确认此工具以以下精确参数调用时仅执行读取。授权绑定当前身份、配置、定义和参数；修改、停用或撤销后失效。外部工具注解不能保证没有副作用。
          </DialogDescription>
          <p className="font-mono text-xs">{state.tool?.remoteToolName}</p>
          <Textarea
            value={state.args}
            onChange={state.changeArgs}
            aria-label="可信只读精确参数 JSON"
            className="font-mono text-xs"
          />
          {state.approvalError && <Notice tone="error">{state.approvalError}</Notice>}
          <Button onClick={state.approve} disabled={state.pending}>
            确认这组参数为只读
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};
