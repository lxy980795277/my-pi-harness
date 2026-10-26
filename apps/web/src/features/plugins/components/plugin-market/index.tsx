import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/select-field';
import { PluginIcon } from '@/features/plugins/components/plugin-icon';
import { PluginActions } from '@/features/plugins/components/plugin-actions';
import type { PluginSettingsState } from '@/features/plugins/types/plugin';

interface PluginMarketProps {
  state: PluginSettingsState;
}

/** Compact rows keep installed and available plugins in one catalog. */
export const PluginMarket: FC<PluginMarketProps> = ({ state }) => {
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">插件市场</h2>
        <div className="w-36">
          <SelectField
            id="plugin-category"
            value={state.category}
            options={state.options}
            onValueChange={state.changeCategory}
            ariaLabel="插件分类"
          />
        </div>
      </div>
      <div className="space-y-1">
        {state.rows.map((row) => {
          return (
            <section
              key={row.plugin.manifest.id}
              aria-label={`${row.plugin.manifest.name} 插件`}
              className="flex items-center gap-3 py-2"
            >
              <Button
                variant="ghost"
                onClick={row.open}
                aria-label={`查看 ${row.plugin.manifest.name} 插件详情`}
                className="h-auto min-w-0 flex-1 justify-start gap-4 rounded-2xl px-2 py-3 text-left text-foreground"
              >
                <PluginIcon id={row.plugin.manifest.id} />
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-medium">{row.plugin.manifest.name}</span>
                  <span className="mt-1 block text-sm leading-5 font-normal text-muted-foreground">
                    {row.plugin.manifest.description}
                  </span>
                </span>
              </Button>
              <PluginActions row={row} pending={state.pending} />
            </section>
          );
        })}
      </div>
    </>
  );
};
