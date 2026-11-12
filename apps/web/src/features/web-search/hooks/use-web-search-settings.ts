import type { WebServiceStatus } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useState, type ChangeEvent, type SubmitEvent } from 'react';
import {
  deleteWebCredential,
  fetchWebServiceStatus,
  saveWebCredential,
} from '@/features/web-search/services/web-search';
import { useAsyncEvent } from '@/hooks/use-async-event';
import type { Action } from '@/types/events';

type CredentialAction = 'save' | 'remove';
interface WebSearchSettingsState {
  status: UseQueryResult<WebServiceStatus, Error>;
  statusLabel: string;
  configured: boolean;
  key: string;
  changeKey: (event: ChangeEvent<HTMLInputElement>) => void;
  submit: (event: SubmitEvent<HTMLFormElement>) => void;
  remove: Action;
  feedback: string | null;
  error: string | null;
  busy: boolean;
  saveDisabled: boolean;
  removeDisabled: boolean;
  refresh: Action;
}

const WEB_SERVICE_QUERY_KEY = ['web-service-status'] as const;

/** Secret drafts live only while this panel is mounted; Query stores public status alone. */
export const useWebSearchSettings = (): WebSearchSettingsState => {
  const client = useQueryClient();
  const status = useQuery({
    queryKey: WEB_SERVICE_QUERY_KEY,
    queryFn: ({ signal }): Promise<WebServiceStatus> => {
      return fetchWebServiceStatus(signal);
    },
    retry: false,
  });
  const [key, setKey] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const update = useAsyncEvent(
    useCallback(
      async (
        signal: AbortSignal,
        action: CredentialAction,
        submittedKey: string,
      ): Promise<void> => {
        setFeedback(null);
        try {
          await client.cancelQueries({ queryKey: WEB_SERVICE_QUERY_KEY });
          signal.throwIfAborted();
          let saved: WebServiceStatus;
          if (action === 'save') {
            saved = await saveWebCredential(submittedKey, signal);
          } else {
            saved = await deleteWebCredential(signal);
          }
          signal.throwIfAborted();
          client.setQueryData(WEB_SERVICE_QUERY_KEY, saved);
          if (action === 'save') {
            setFeedback('API Key 已保存。');
          } else {
            setFeedback('API Key 已移除。');
          }
        } catch (failure) {
          if (!signal.aborted) {
            await client.invalidateQueries(
              { queryKey: WEB_SERVICE_QUERY_KEY },
              { throwOnError: false },
            );
          }
          throw failure;
        }
      },
      [client],
    ),
  );
  const { clearError, run } = update;
  const changeKey = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      setKey(event.target.value);
      setFeedback(null);
      clearError();
    },
    [clearError],
  );
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      const submittedKey = key.trim();
      if (submittedKey.length === 0) {
        return;
      }
      setKey('');
      run('save', submittedKey);
    },
    [key, run],
  );
  const remove = useCallback((): void => {
    setKey('');
    run('remove', '');
  }, [run]);
  const refresh = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await client.invalidateQueries({ queryKey: WEB_SERVICE_QUERY_KEY });
    }, [client]),
  );
  let statusLabel = '正在读取配置';
  if (status.isError) {
    statusLabel = '配置读取失败';
  } else if (status.data?.configured) {
    statusLabel = '已配置';
  } else if (status.isSuccess) {
    statusLabel = '未配置';
  }
  const configured = status.data?.configured === true;
  return {
    status,
    statusLabel,
    configured,
    key,
    changeKey,
    submit,
    remove,
    feedback,
    error: update.error,
    busy: update.pending,
    saveDisabled: !status.isSuccess || update.pending || key.trim().length === 0,
    removeDisabled: !configured || update.pending,
    refresh: refresh.run,
  };
};
