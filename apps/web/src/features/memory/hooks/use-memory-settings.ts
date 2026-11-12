import type { MemorySettingsInput } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { MEMORY_SETTINGS_QUERY } from '@/features/memory/hooks/use-memory-queries';
import { saveMemorySettings } from '@/features/memory/services/memory';
import type { MemorySettingKey, MemorySettingsState } from '@/features/memory/types/memory';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Use and learning update independently while sharing the exact server revision and retry receipt. */
export const useMemorySettings = (): MemorySettingsState => {
  const settings = useQuery(MEMORY_SETTINGS_QUERY);
  const client = useQueryClient();
  const attempt = useRef<MemorySettingsInput | null>(null);
  const current = settings.data;
  const updateSettings = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, key: MemorySettingKey, value: boolean): Promise<void> => {
        if (current === undefined) throw new Error('请等待记忆设置加载完成。');
        const values = {
          allowUse: current.allowUse,
          allowLearning: current.allowLearning,
          [key]: value,
        };
        let input = attempt.current;
        if (
          input === null ||
          input.allowUse !== values.allowUse ||
          input.allowLearning !== values.allowLearning ||
          input.expectedRevision !== current.revision
        ) {
          input = { requestId: crypto.randomUUID(), expectedRevision: current.revision, ...values };
          attempt.current = input;
        }
        try {
          const updated = await saveMemorySettings(input, signal);
          signal.throwIfAborted();
          client.setQueryData(MEMORY_SETTINGS_QUERY.queryKey, updated);
          attempt.current = null;
        } finally {
          await client.invalidateQueries({ queryKey: MEMORY_SETTINGS_QUERY.queryKey });
        }
      },
      [client, current],
    ),
  );
  const { run } = updateSettings;
  const changeAllowUse = useCallback(
    (value: boolean): void => {
      run('allowUse', value);
    },
    [run],
  );
  const changeAllowLearning = useCallback(
    (value: boolean): void => {
      run('allowLearning', value);
    },
    [run],
  );
  return { settings, updateSettings, changeAllowUse, changeAllowLearning };
};
