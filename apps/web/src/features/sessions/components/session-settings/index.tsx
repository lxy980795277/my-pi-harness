import type { ProviderConfig, SessionPatchInput, SessionSummary } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { useSessionSettings } from '@/features/sessions/hooks/use-session-settings';

interface SessionSettingsProps {
  session: SessionSummary;
  providers: ProviderConfig[];
  onPatch: (input: SessionPatchInput) => Promise<void>;
}

/** Settings change future runs; an active run keeps its frozen model parameters. */
export const SessionSettings: FC<SessionSettingsProps> = ({ session, providers, onPatch }) => {
  const state = useSessionSettings(session, providers, onPatch);
  return (
    <details className="shrink-0 border-b border-border/60 px-6 pb-3">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        会话与模型设置 · {session.modelId}
      </summary>
      <form onSubmit={state.submit} className="mt-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="会话名称" htmlFor={`session-title-${session.id}`}>
            <Input
              id={`session-title-${session.id}`}
              value={state.title}
              required
              disabled={state.pending}
              onChange={state.changeTitle}
            />
          </Field>
          <Field label="Provider" htmlFor={`session-provider-${session.id}`}>
            <SelectField
              id={`session-provider-${session.id}`}
              value={state.providerId}
              options={state.providerOptions}
              onValueChange={state.changeProvider}
              disabled={state.pending}
              placeholder="请选择 Provider"
            />
          </Field>
          <Field label="模型" htmlFor={`session-model-${session.id}`}>
            <SelectField
              id={`session-model-${session.id}`}
              value={state.modelId}
              options={state.modelOptions}
              onValueChange={state.changeModel}
              disabled={state.pending || !state.modelsReady}
              placeholder="请选择模型"
            />
          </Field>
          <Field label="推理强度" htmlFor={`session-thinking-${session.id}`}>
            <SelectField
              id={`session-thinking-${session.id}`}
              value={state.thinkingLevel}
              options={state.thinkingOptions}
              onValueChange={state.changeThinking}
              disabled={state.pending}
            />
          </Field>
        </div>
        {state.legacy && <Notice>此会话保留历史 Provider 配置；切换模型需要你的明确选择。</Notice>}
        {state.error && <Notice tone="error">{state.error}</Notice>}
        {session.activeRunId && (
          <Notice>当前运行继续使用启动时的模型与参数快照；保存设置只影响下一个运行。</Notice>
        )}
        <Button type="submit" variant="outline" disabled={state.disabled}>
          保存会话设置
        </Button>
      </form>
    </details>
  );
};
