import type { FC } from 'react';
import { ArrowLeft, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PluginMarket } from '@/features/plugins/components/plugin-market';
import { PluginDetail } from '@/features/plugins/components/plugin-detail';
import { PluginSkillDetail } from '@/features/plugins/components/plugin-skill-detail';
import { PluginAppDetail } from '@/features/plugins/components/plugin-app-detail';
import { usePluginSettings } from '@/features/plugins/hooks/use-plugin-settings';

/** Navigation replaces the settings content without opening another dialog. */
export const PluginsSettings: FC = () => {
  const state = usePluginSettings();
  return (
    <section
      key={state.pageKey}
      ref={state.mountPage}
      aria-label={state.pageLabel}
      tabIndex={-1}
      className="space-y-6 p-6 outline-none sm:p-8"
    >
      {state.page.type !== 'market' && (
        <Button variant="secondary" onClick={state.back} className="rounded-full px-4">
          <ArrowLeft width={16} height={16} aria-hidden />
          {state.backLabel}
        </Button>
      )}
      {state.error && (
        <Notice tone="error">
          <div className="flex items-center justify-between gap-3">
            <span>{state.error}</span>
            <Button variant="ghost" onClick={state.retry} disabled={state.pending}>
              <RotateCw width={14} height={14} aria-hidden />
              重试
            </Button>
          </div>
        </Notice>
      )}
      {state.loading && (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取插件…
        </p>
      )}
      {state.page.type === 'market' && <PluginMarket state={state} />}
      {state.page.type === 'plugin' && state.selected !== null && (
        <PluginDetail state={state} row={state.selected} />
      )}
      {state.page.type === 'skill' && state.selected !== null && state.activeSkill !== null && (
        <PluginSkillDetail pluginId={state.selected.plugin.manifest.id} skill={state.activeSkill} />
      )}
      {state.page.type === 'app' && state.selected !== null && state.activeApp !== null && (
        <PluginAppDetail
          app={state.activeApp}
          pluginId={state.selected.plugin.manifest.id}
          pluginName={state.selected.plugin.manifest.name}
        />
      )}
    </section>
  );
};
