import type { FC } from 'react';
import { Check, Plug } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { DialogDescription } from '@/components/ui/dialog/dialog-description';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import type { McpSelectionState } from '@/features/mcp/types/mcp';

interface McpToolPickerProps {
  state: McpSelectionState;
}
/** Only cached discovered tools are selectable; opening this dialog never spawns a server. */
export const McpToolPicker: FC<McpToolPickerProps> = ({ state }) => {
  return (
    <Dialog open={state.open} onOpenChange={state.changeOpen}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-auto" closeLabel="关闭 MCP 工具选择">
        <DialogTitle>MCP 工具 · 已选 {state.selected.length}/16</DialogTitle>
        <DialogDescription>
          选择本次输入可使用的工具。目录变化后需要重新选择，运行中使用已冻结的工具集合。
        </DialogDescription>
        {state.locked && <Notice>当前选择已冻结，运行或提交结束后可以修改。</Notice>}
        {state.workspaceMissing && <Notice>本地 stdio 工具需要工作区；远程工具可直接使用。</Notice>}
        {state.planMode && <Notice>计划模式只能使用已明确授予精确参数只读权限的外部工具。</Notice>}
        {state.readOnly && <Notice>只读模式只能使用已明确授予精确参数只读权限的外部工具。</Notice>}
        {state.loading && (
          <p role="status" className="text-xs text-muted-foreground">
            正在读取工具目录…
          </p>
        )}
        {state.error && <Notice tone="error">{state.error}</Notice>}
        {state.invalid.length > 0 && (
          <div className="space-y-2">
            <Notice tone="error">{state.invalid.length} 项选择已失效，请移除后重新选择。</Notice>
            {state.invalid.map((tool) => {
              return (
                <p
                  key={`${tool.serverId}:${tool.remoteToolName}:${tool.definitionFingerprint}`}
                  className="text-xs text-muted-foreground"
                >
                  {tool.remoteToolName} · revision {tool.serverRevision}
                </p>
              );
            })}
            <Button
              type="button"
              variant="outline"
              onClick={state.removeInvalid}
              disabled={state.locked}
            >
              移除失效选择
            </Button>
          </div>
        )}
        <div className="space-y-1">
          {state.rows.map((row) => {
            return (
              <Button
                key={row.key}
                type="button"
                variant="ghost"
                className="h-auto w-full justify-start gap-3 px-3 py-3 text-left"
                onClick={row.change}
                disabled={row.disabled}
                aria-pressed={row.selected}
              >
                <Plug width={16} height={16} className="shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {row.serverName} · {row.tool.remoteToolName}
                  </span>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    {row.tool.description}
                  </span>
                  {!row.tool.available && (
                    <span className="block text-xs text-warning-solid">{row.tool.diagnostic}</span>
                  )}
                </span>
                {row.selected && <Check width={16} height={16} className="shrink-0" aria-hidden />}
              </Button>
            );
          })}
        </div>
        {!state.loading && state.rows.length === 0 && !state.workspaceMissing && (
          <p className="text-xs text-muted-foreground">
            当前工作区和权限范围没有已发现的工具，请先在设置中配置、授权并发现。
          </p>
        )}
        <Button type="button" variant="outline" onClick={state.settings}>
          打开 MCP 设置
        </Button>
      </DialogContent>
    </Dialog>
  );
};
