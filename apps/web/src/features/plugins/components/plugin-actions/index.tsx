import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { PluginSettingsRow } from '@/features/plugins/types/plugin';

interface PluginActionsProps {
  row: PluginSettingsRow;
  pending: boolean;
}

/** Actions are siblings of the detail link, so toggling never changes the current page. */
export const PluginActions: FC<PluginActionsProps> = ({ row, pending }) => {
  return (
    <div className="flex shrink-0 items-center gap-3">
      {!row.plugin.installed && (
        <Button className="rounded-full px-4" onClick={row.install} disabled={pending}>
          安装
        </Button>
      )}
      {row.plugin.installed && (
        <>
          <Switch
            checked={row.plugin.enabled}
            onCheckedChange={row.toggle}
            disabled={pending}
            aria-label={`启用 ${row.plugin.manifest.name} 插件`}
          />
          <Button
            variant="ghost"
            className="rounded-full bg-error px-4 text-error-foreground hover:bg-error/80 hover:text-error-foreground"
            onClick={row.remove}
            disabled={pending}
          >
            卸载
          </Button>
        </>
      )}
    </div>
  );
};
