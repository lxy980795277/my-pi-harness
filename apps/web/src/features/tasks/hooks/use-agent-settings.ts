import type { AgentLimits, AgentRole, AgentSettings } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useState, type SubmitEvent } from 'react';
import type { AgentLimitField, AgentSettingsEditorState } from '@/features/tasks/types/tasks';
import { PROVIDERS_QUERY_OPTIONS } from '@/features/models/queries/catalog';
import { fetchAgentSettings, saveAgentSettings } from '@/features/tasks/services/agents';
import { useAsyncEvent } from '@/hooks/use-async-event';

const LIMIT_LABELS: Record<keyof AgentLimits, string> = {
  maxTasks: '整树任务数上限',
  maxDepth: '嵌套深度上限',
  maxConcurrentRequests: '并发模型请求数',
  maxTurns: '每次执行轮数上限',
  timeoutMs: '整树执行时限（秒）',
  maxOutputTokens: '单次请求输出上限',
};

/** The saved configuration remains server-owned; only unsubmitted edits are local. */
export const useAgentSettingsQuery = (): UseQueryResult<AgentSettings, Error> => {
  return useQuery({
    queryKey: ['agent-settings'],
    queryFn: ({ signal }) => {
      return fetchAgentSettings(signal);
    },
  });
};

/** Concurrent settings changes retain the original edited revision and fail visibly on save. */
export const useAgentSettingsEditor = (initial: AgentSettings): AgentSettingsEditorState => {
  const client = useQueryClient();
  const providers = useQuery(PROVIDERS_QUERY_OPTIONS);
  const [draft, setDraft] = useState(initial);
  const save = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        const updated = await saveAgentSettings(draft, signal);
        signal.throwIfAborted();
        client.setQueryData(['agent-settings'], updated);
        setDraft(updated);
      },
      [client, draft],
    ),
  );
  const { run } = save;
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>): void => {
      event.preventDefault();
      run();
    },
    [run],
  );
  const changeEnabled = useCallback((enabled: boolean): void => {
    setDraft((current) => {
      return { ...current, enabled };
    });
  }, []);
  const updateRole = useCallback((role: AgentRole): void => {
    setDraft((current) => {
      return {
        ...current,
        roles: current.roles.map((entry) => {
          if (entry.id === role.id) return role;
          return entry;
        }),
      };
    });
  }, []);
  const reload = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        const updated = await fetchAgentSettings(signal);
        signal.throwIfAborted();
        client.setQueryData(['agent-settings'], updated);
        setDraft(updated);
      },
      [client],
    ),
  );
  const fields = (Object.keys(LIMIT_LABELS) as (keyof AgentLimits)[]).map(
    (key): AgentLimitField => {
      let value = draft.limits[key];
      if (key === 'timeoutMs') value /= 1000;
      return {
        key,
        label: LIMIT_LABELS[key],
        value,
        change: (event): void => {
          let next = Number(event.target.value);
          if (key === 'timeoutMs') next *= 1000;
          setDraft((current) => {
            return { ...current, limits: { ...current.limits, [key]: next } };
          });
        },
      };
    },
  );
  return {
    draft,
    fields,
    providers: providers.data ?? [],
    save,
    submit,
    changeEnabled,
    updateRole,
    reload,
  };
};
