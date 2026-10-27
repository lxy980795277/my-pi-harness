import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { PluginIcon } from '@/features/plugins/components/plugin-icon';
import { PluginActions } from '@/features/plugins/components/plugin-actions';
import { PluginAuthorization } from '@/features/plugins/components/plugin-authorization';
import { PluginAppRow } from '@/features/plugins/components/plugin-app-row';
import type { PluginSettingsRow, PluginSettingsState } from '@/features/plugins/types/plugin';

interface PluginDetailProps {
  state: PluginSettingsState;
  row: PluginSettingsRow;
}

/** The plugin switch controls all components; each component can also be enabled individually. */
export const PluginDetail: FC<PluginDetailProps> = ({ state, row }) => {
  return (
    <div className="space-y-9">
      <div className="flex items-start gap-4">
        <PluginIcon id={row.plugin.manifest.id} large />
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold">{row.plugin.manifest.name}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {row.plugin.manifest.description}
          </p>
        </div>
        <PluginActions row={row} pending={state.pending} />
      </div>
      {row.plugin.installed && row.plugin.manifest.category === 'services' && (
        <PluginAuthorization
          key={row.plugin.manifest.id}
          plugin={row.plugin}
          disabled={state.pending}
        />
      )}
      {state.apps.length > 0 && (
        <section aria-label="包含的应用" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">
              包含的应用{' '}
              <span className="ml-2 font-normal text-muted-foreground">{state.apps.length}</span>
            </h3>
          </div>
          {state.apps.map((app) => {
            return (
              <PluginAppRow
                key={app.id}
                app={app}
                pluginId={row.plugin.manifest.id}
                installed={row.plugin.installed}
              />
            );
          })}
        </section>
      )}
      {state.skills.length > 0 && (
        <section aria-label="包含的技能" className="space-y-1">
          <h3 className="mb-3 text-sm font-semibold">
            包含的技能{' '}
            <span className="ml-2 font-normal text-muted-foreground">{state.skills.length}</span>
          </h3>
          {state.skills.map((skill) => {
            return (
              <div key={skill.name} className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  className="h-auto min-w-0 flex-1 justify-start gap-4 rounded-2xl px-2 py-3 text-left text-foreground"
                  onClick={skill.open}
                  aria-label={`查看 ${skill.name} 技能详情`}
                >
                  <PluginIcon id={row.plugin.manifest.id} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-medium">{skill.name}</span>
                    <span className="mt-1 block text-sm leading-5 font-normal text-muted-foreground">
                      {skill.description}
                    </span>
                  </span>
                </Button>
                <Switch
                  checked={skill.enabled}
                  onCheckedChange={skill.change}
                  disabled={skill.disabled}
                  aria-label={`启用 ${skill.name} 技能`}
                />
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
};
