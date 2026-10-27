import type { FC } from 'react';
import type { RemoteMcpView } from '@my-pi-harness/protocol';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Switch } from '@/components/ui/switch';
import { usePluginAppConnection } from '@/features/plugins/hooks/use-plugin-app-connection';

interface PluginAppConnectionProps {
  server: RemoteMcpView;
  pluginId: string;
  usesPluginOAuth: boolean;
  disabled: boolean;
}

/** App details expose authorization and capabilities without repeating account or endpoint setup. */
export const PluginAppConnection: FC<PluginAppConnectionProps> = ({
  server,
  pluginId,
  usesPluginOAuth,
  disabled,
}) => {
  const state = usePluginAppConnection(server, pluginId, usesPluginOAuth, disabled);
  return (
    <div className="space-y-8">
      {server.enabled && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">授权</h3>
            <p className="mt-1 text-sm text-muted-foreground">{state.authDescription}</p>
          </div>
          {state.canAuthorize && (
            <Button className="rounded-full" onClick={state.authorize} disabled={state.pending}>
              {state.authLabel}
            </Button>
          )}
        </div>
      )}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {server.catalogStatus === 'error' && server.catalogError !== undefined && (
        <Notice tone="error">{server.catalogError.message}</Notice>
      )}
      <section aria-label="应用工具" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">工具</h3>
          <Button
            variant="secondary"
            onClick={state.refresh}
            disabled={state.pending || !state.canRefresh}
          >
            刷新工具
          </Button>
        </div>
        {state.pending && (
          <p role="status" className="text-sm text-muted-foreground">
            正在连接…
          </p>
        )}
        {state.catalog === null && !state.pending && (
          <p className="text-sm text-muted-foreground">暂无工具目录</p>
        )}
        {state.toolRows.map((row) => {
          return (
            <div
              key={row.tool.remoteToolName}
              className="flex items-start gap-3 rounded-xl bg-muted/50 px-4 py-3 text-foreground"
            >
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-mono break-all">{row.tool.remoteToolName}</p>
                <p className="mt-1 leading-5 text-muted-foreground">{row.tool.description}</p>
                {row.tool.diagnostic && (
                  <p className="mt-1 text-warning-solid">{row.tool.diagnostic}</p>
                )}
              </div>
              <Switch
                checked={row.tool.enabled !== false}
                onCheckedChange={row.change}
                disabled={state.pending || !state.canRefresh}
                aria-label={`启用 ${row.tool.remoteToolName} 工具`}
              />
            </div>
          );
        })}
      </section>
    </div>
  );
};
