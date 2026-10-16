import type { SecretInputType } from '@/types/input';
import type { AuthFlow } from '@my-pi-harness/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import type { SelectOption } from '@/components/ui/select-field';
import type { Action, FormSubmit, InputChange, ValueChange } from '@/types/events';

export interface PromptPresentation {
  title: string;
  label: string;
  description: string;
  inputType: SecretInputType;
  canSubmitEmpty: boolean;
  options: SelectOption[];
  placeholder: string | undefined;
}
export interface OAuthPromptState {
  value: string;
  setValue: Dispatch<SetStateAction<string>>;
  changeValue: InputChange;
  submit: FormSubmit;
  pending: boolean;
  error: string | null;
  presentation: PromptPresentation;
  disabled: boolean;
}
export interface OAuthFlowState {
  query: UseQueryResult<AuthFlow, Error>;
  flow: AuthFlow | undefined;
  safeUrl: string | null;
  urlError: string | null;
  statusLabel: string;
  cancel: Action;
  cancelPending: boolean;
  actionError: string | null;
  openDesktop: Action;
  desktop: boolean;
  receive: ValueChange<AuthFlow>;
}
export interface PairingFormState {
  code: string;
  change: InputChange;
  submit: FormSubmit;
  pending: boolean;
  error: string | null;
}
export interface AuthFlowWorkspaceState {
  query: UseQueryResult<AuthFlow[], Error>;
  options: SelectOption[];
  activeId: string;
  visible: boolean;
  select: ValueChange<string>;
  hide: Action;
  show: Action;
}
