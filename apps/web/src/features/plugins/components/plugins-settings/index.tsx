import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { usePluginSettings } from '@/features/plugins/hooks/use-plugin-settings';

/** Built-in plugins compose Skills and Apps; installation does not authorize external accounts. */
export const PluginsSettings: FC = () => {
  const state = usePluginSettings();
  return (
    <div className="space-y-5 p-8">
      <h2 className="text-xl font-semibold">插件</h2>
      <SelectField
        id="plugin-category"
        value={state.category}
        options={state.options}
        onValueChange={state.changeCategory}
        ariaLabel="插件分类"
      />
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.loading && (
        <p role="status" className="text-xs text-muted-foreground">
          正在读取插件…
        </p>
      )}
      {state.rows.map((row) => {
        return (
          <div
            key={row.plugin.manifest.id}
            className="space-y-3 rounded-xl border border-border p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-medium">{row.plugin.manifest.name}</h3>
                <p className="mt-1 text-xs leading-6 text-muted-foreground">
                  {row.plugin.manifest.description}
                </p>
              </div>
              <div className="flex gap-2">
                {!row.plugin.installed && (
                  <Button onClick={row.install} disabled={state.pending}>
                    安装
                  </Button>
                )}
                {row.plugin.installed && (
                  <>
                    <Button variant="outline" onClick={row.toggle} disabled={state.pending}>
                      {row.plugin.enabled && '停用'}
                      {!row.plugin.enabled && '启用'}
                    </Button>
                    <Button variant="ghost" onClick={row.remove} disabled={state.pending}>
                      卸载
                    </Button>
                  </>
                )}
              </div>
            </div>
            {row.plugin.installed && (
              <div className="space-y-2 border-t border-border pt-3">
                {row.components.map((component) => {
                  return (
                    <div className="flex items-center justify-between gap-2" key={component.id}>
                      <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                        <span>{component.label}</span>
                        {component.status && <p className="mt-1">{component.status}</p>}
                      </div>
                      {component.isApp && (
                        <>
                          <Button variant="ghost" onClick={component.manage}>
                            管理 MCP
                          </Button>
                          <Button variant="ghost" onClick={component.connections}>
                            管理连接
                          </Button>
                        </>
                      )}
                      <Button variant="ghost" onClick={component.change} disabled={state.pending}>
                        {component.enabled && '停用'}
                        {!component.enabled && '启用'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
