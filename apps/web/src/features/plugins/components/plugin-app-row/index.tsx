import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Notice } from '@/components/ui/notice';
import { PluginIcon } from '@/features/plugins/components/plugin-icon';
import { usePluginAppRow } from '@/features/plugins/hooks/use-plugin-app-row';
import type { PluginAppRow as PluginApp } from '@/features/plugins/types/plugin';

interface PluginAppRowProps {
  app: PluginApp;
  pluginId: string;
  installed: boolean;
}

/** Apps stay compact in the plugin page and open their own details for capabilities. */
export const PluginAppRow: FC<PluginAppRowProps> = ({ app, pluginId, installed }) => {
  const state = usePluginAppRow(app);
  return (
    <div className="space-y-3 py-3">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          className="h-auto min-w-0 flex-1 justify-start gap-4 rounded-2xl px-2 py-3 text-left text-foreground"
          onClick={app.open}
          aria-label={`查看 ${app.name} 应用详情`}
        >
          <PluginIcon id={pluginId} />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-medium">{app.name}</span>
            <span className="mt-1 block text-sm leading-5 font-normal text-muted-foreground">
              {app.description}
            </span>
          </span>
        </Button>
        {installed && !state.authorizationRequired && (
          <Button variant="secondary" className="rounded-full" onClick={app.open}>
            {app.status}
          </Button>
        )}
        {installed && state.authorizationRequired && (
          <Button
            className="rounded-full"
            onClick={state.authorize}
            disabled={state.pending}
            aria-label={`授权 ${app.name}`}
          >
            {state.authorizationLabel}
          </Button>
        )}
        <Switch
          checked={app.enabled}
          onCheckedChange={app.change}
          disabled={app.disabled}
          aria-label={`启用 ${app.name} 应用`}
        />
      </div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </div>
  );
};
