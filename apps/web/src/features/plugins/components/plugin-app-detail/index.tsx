import type { FC } from 'react';
import { Switch } from '@/components/ui/switch';
import { PluginIcon } from '@/features/plugins/components/plugin-icon';
import { PluginAppConnection } from '@/features/plugins/components/plugin-app-connection';
import {
  pluginAppAuthorizationLabel,
  pluginAppTransportLabel,
} from '@/features/plugins/utils/plugin-connections';
import type { PluginAppRow } from '@/features/plugins/types/plugin';

interface PluginAppDetailProps {
  app: PluginAppRow;
  pluginId: string;
  pluginName: string;
}

/** An App has its own settings page; authorization remains independent from its availability switch. */
export const PluginAppDetail: FC<PluginAppDetailProps> = ({ app, pluginId, pluginName }) => {
  const authorization = pluginAppAuthorizationLabel(app, pluginName);
  const transport = pluginAppTransportLabel(app);
  return (
    <div className="space-y-8">
      <div className="flex items-start gap-4">
        <PluginIcon id={pluginId} large />
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold">{app.name}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{app.description}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{app.status}</span>
          <Switch
            checked={app.enabled}
            onCheckedChange={app.change}
            disabled={app.disabled}
            aria-label={`启用 ${app.name} 应用`}
          />
        </div>
      </div>
      <dl className="grid gap-5 rounded-2xl bg-muted/60 p-5 text-sm text-foreground sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">所属插件</dt>
          <dd className="mt-1">{pluginName}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">应用 ID</dt>
          <dd className="mt-1">{app.id}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">连接方式</dt>
          <dd className="mt-1">{transport}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">鉴权</dt>
          <dd className="mt-1">{authorization}</dd>
        </div>
      </dl>
      {app.server !== null && (
        <PluginAppConnection
          server={app.server}
          pluginId={pluginId}
          usesPluginOAuth={app.usesPluginOAuth}
          disabled={app.disabled || !app.enabled}
        />
      )}
    </div>
  );
};
