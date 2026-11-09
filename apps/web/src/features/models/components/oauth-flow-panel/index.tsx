import type { FC } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { OAuthPrompt } from '@/features/models/components/oauth-prompt';
import { useOAuthFlow } from '@/features/models/hooks/use-oauth-flow';
import { describeError } from '@/utils/describe-error';

interface OAuthFlowPanelProps {
  flowId: string;
  onCompleted: () => void;
}

/** Model-provider authorization remains inside its owning settings dialog. */
export const OAuthFlowPanel: FC<OAuthFlowPanelProps> = ({ flowId, onCompleted }) => {
  const state = useOAuthFlow(flowId, onCompleted);
  return (
    <section className="space-y-4" aria-label="OAuth 授权">
      {state.query.isPending && <Notice>正在准备登录…</Notice>}
      {state.query.isError && <Notice tone="error">{describeError(state.query.error)}</Notice>}
      {state.actionError && <Notice tone="error">{state.actionError}</Notice>}
      {state.urlError && <Notice tone="error">{state.urlError}</Notice>}
      {state.flow && (
        <>
          <p className="text-sm font-medium" aria-live="polite">
            {state.statusLabel}
          </p>
          {state.flow.message && (
            <p className="text-xs leading-6 text-muted-foreground">{state.flow.message}</p>
          )}
          {state.flow.error && <Notice tone="error">{state.flow.error}</Notice>}
          {state.flow.deviceCode && (
            <Field label="设备码" htmlFor={`device-code-${flowId}`}>
              <Input
                id={`device-code-${flowId}`}
                readOnly
                value={state.flow.deviceCode}
                className="font-mono tracking-widest"
              />
            </Field>
          )}
          {state.flow.prompt && (
            <OAuthPrompt
              key={state.flow.prompt.id}
              flowId={flowId}
              prompt={state.flow.prompt}
              onRespond={state.receive}
            />
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {state.flow.status === 'pending' && (
              <Button
                type="button"
                variant="ghost"
                disabled={state.cancelPending}
                onClick={state.cancel}
              >
                取消登录
              </Button>
            )}
            {state.safeUrl && !state.desktop && (
              <Button asChild variant="secondary" className="rounded-full">
                <a href={state.safeUrl} target="_blank" rel="noopener noreferrer">
                  打开授权页面
                </a>
              </Button>
            )}
            {state.safeUrl && state.desktop && (
              <Button
                type="button"
                variant="secondary"
                className="rounded-full"
                onClick={state.openDesktop}
              >
                打开授权页面
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
};
