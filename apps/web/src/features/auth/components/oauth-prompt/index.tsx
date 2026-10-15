import type { AuthFlow } from '@my-pi-harness/protocol';
import type { FC } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { SelectField } from '@/components/ui/select-field';
import { useOAuthPrompt } from '@/features/auth/hooks/use-oauth-prompt';

interface OAuthPromptProps {
  flowId: string;
  prompt: NonNullable<AuthFlow['prompt']>;
  onRespond: (flow: AuthFlow) => void;
}

/** Prompt controls render prepared copy; the local hook owns all secret submission work. */
export const OAuthPrompt: FC<OAuthPromptProps> = ({ flowId, prompt, onRespond }) => {
  const state = useOAuthPrompt(flowId, prompt, onRespond);
  return (
    <form className="space-y-4" onSubmit={state.submit}>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{state.presentation.title}</h3>
        <p className="text-xs leading-6 text-muted-foreground">{state.presentation.description}</p>
      </div>
      <Field label={state.presentation.label} htmlFor={`oauth-prompt-${prompt.id}`}>
        {prompt.type !== 'select' && (
          <Input
            id={`oauth-prompt-${prompt.id}`}
            type={state.presentation.inputType}
            placeholder={state.presentation.placeholder}
            autoComplete="off"
            value={state.value}
            disabled={state.pending}
            required={!state.presentation.canSubmitEmpty}
            onChange={state.changeValue}
          />
        )}
        {prompt.type === 'select' && (
          <SelectField
            id={`oauth-prompt-${prompt.id}`}
            value={state.value}
            options={state.presentation.options}
            placeholder="请选择登录方式"
            onValueChange={state.setValue}
            disabled={state.pending}
          />
        )}
      </Field>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <div className="flex justify-end">
        <Button type="submit" disabled={state.disabled} className="rounded-full">
          继续
        </Button>
      </div>
    </form>
  );
};
