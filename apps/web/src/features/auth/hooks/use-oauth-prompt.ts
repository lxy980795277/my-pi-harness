import type { OAuthPromptState } from '@/features/auth/types/auth';
import type { AuthFlow } from '@my-pi-harness/protocol';
import { useCallback, useState, type ChangeEvent, type SubmitEvent } from 'react';

import { respondToAuthFlow } from '@/features/auth/services/auth';
import { getPromptPresentation } from '@/features/auth/utils/oauth-view';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Secret replies never become mutation variables or request-cache entries. */
export const useOAuthPrompt = (
  flowId: string,
  prompt: NonNullable<AuthFlow['prompt']>,
  onRespond: (flow: AuthFlow) => void,
): OAuthPromptState => {
  const [value, setValue] = useState('');
  const presentation = getPromptPresentation(prompt);
  const operation = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, submittedValue: string): Promise<void> => {
        const response = await respondToAuthFlow(flowId, prompt.id, submittedValue, signal);
        signal.throwIfAborted();
        onRespond(response);
      },
      [flowId, onRespond, prompt.id],
    ),
  );
  const { run: operationRun } = operation;
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      const submittedValue = value;
      setValue('');
      operationRun(submittedValue);
    },
    [operationRun, value],
  );
  const changeValue = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setValue(event.target.value);
  }, []);
  return {
    value,
    setValue,
    changeValue,
    submit,
    pending: operation.pending,
    error: operation.error,
    presentation,
    disabled: operation.pending || (!presentation.canSubmitEmpty && value.trim().length === 0),
  };
};
