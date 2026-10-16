import type { ProviderEditorFields } from '@/features/models/types/model';
import { useCallback, type ChangeEvent } from 'react';
import type { SelectOption } from '@/components/ui/select-field';
import type { useProviderEditor } from '@/features/models/hooks/use-provider-editor';

const PROTOCOL_OPTIONS: SelectOption[] = [
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
];

/** DOM adapters keep form components free of value parsing and protocol decisions. */
export const useProviderEditorFields = (
  editor: ReturnType<typeof useProviderEditor>,
): ProviderEditorFields => {
  const { setKey: editorSetKey } = editor;
  const { setBaseUrl: editorSetBaseUrl } = editor;
  const { setName: editorSetName } = editor;
  const changeName = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      editorSetName(event.target.value);
    },
    [editorSetName],
  );
  const changeBaseUrl = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      editorSetBaseUrl(event.target.value);
    },
    [editorSetBaseUrl],
  );
  const changeKey = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      editorSetKey(event.target.value);
    },
    [editorSetKey],
  );
  let baseUrlPlaceholder = 'https://api.example.com/v1';
  if (editor.api === 'anthropic-messages') {
    baseUrlPlaceholder = 'https://api.anthropic.com';
  }
  return {
    changeName,
    changeBaseUrl,
    changeKey,
    baseUrlPlaceholder,
    protocolOptions: PROTOCOL_OPTIONS,
  };
};
