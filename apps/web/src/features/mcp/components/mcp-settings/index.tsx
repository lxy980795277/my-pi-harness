import type { FC } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { McpServerForm } from '@/features/mcp/components/mcp-server-form';
import { McpServerItem } from '@/features/mcp/components/mcp-server-item';
import { RemoteMcpSettings } from '@/features/mcp/components/remote-mcp-settings';
import { McpConfigurationExchange } from '@/features/mcp/components/mcp-configuration-exchange';
import { useMcpSettings } from '@/features/mcp/hooks/use-mcp-settings';

/** Remote configuration is primary; process startup and configuration exchange stay in advanced settings. */
export const McpSettings: FC = () => {
  const state = useMcpSettings();
  return (
    <div className="space-y-6 p-8">
      <RemoteMcpSettings />
      <details className="rounded-2xl border border-border p-4">
        <summary className="cursor-pointer text-sm text-muted-foreground">高级配置</summary>
        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">本地进程</h3>
            <Button type="button" variant="outline" className="rounded-full" onClick={state.create}>
              <Plus width={14} height={14} aria-hidden />
              添加本地 MCP
            </Button>
          </div>
          {state.servers.isPending && (
            <p role="status" className="text-xs text-muted-foreground">
              正在读取配置…
            </p>
          )}
          {state.servers.error && <Notice tone="error">{state.servers.error.message}</Notice>}
          {state.rows.map(({ server, workspaceName }) => {
            return (
              <McpServerItem
                workspaceName={workspaceName}
                key={server.id}
                server={server}
                onEdit={state.edit}
              />
            );
          })}
          <McpConfigurationExchange />
        </div>
      </details>
      {state.editing !== undefined && (
        <McpServerForm key={state.editorKey} server={state.editing} onClose={state.close} />
      )}
    </div>
  );
};
