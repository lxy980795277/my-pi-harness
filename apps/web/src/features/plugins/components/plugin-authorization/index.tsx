import type { FC } from 'react';
import type { PluginView } from '@my-pi-harness/protocol';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { usePluginAuthorization } from '@/features/plugins/hooks/use-plugin-authorization';

interface PluginAuthorizationProps {
  plugin: PluginView;
  disabled: boolean;
}

/** Authorization uses daemon configuration without exposing account creation or client forms. */
export const PluginAuthorization: FC<PluginAuthorizationProps> = ({ plugin, disabled }) => {
  const state = usePluginAuthorization(plugin);
  const controlsDisabled = disabled || state.pending || state.loading || state.waiting;
  return (
    <section aria-label="插件授权" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-muted/70 px-5 py-4 text-foreground">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Skill 网关授权</h3>
          <p role="status" className="mt-1 text-sm leading-6 text-muted-foreground">
            {state.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          {!state.connected && (
            <Button className="rounded-full" onClick={state.activate} disabled={controlsDisabled}>
              {state.label}
            </Button>
          )}
          {state.connected && (
            <Button
              variant="secondary"
              className="rounded-full"
              onClick={state.activate}
              disabled={controlsDisabled}
            >
              {state.label}
            </Button>
          )}
        </div>
      </div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </section>
  );
};
