import type {
  MemoryEntry,
  MemoryForgetInput,
  MemoryPage,
  MemoryUpdateInput,
} from '@my-pi-harness/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { forgetMemory, updateMemory } from '@/features/memory/services/memory';
import { refreshMemoryFacts } from '@/features/memory/queries/cache';
import type { MemoryRowState } from '@/features/memory/types/memory';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Entry actions keep revision-checked requests; no optimistic fact is published. */
export const useMemoryRow = (
  entry: MemoryEntry,
  onEdit: (entry: MemoryEntry) => void,
  onChanged: () => void,
): MemoryRowState => {
  const client = useQueryClient();
  const [forgetting, setForgetting] = useState(false);
  const updateAttempt = useRef<MemoryUpdateInput | null>(null);
  const forgetAttempt = useRef<MemoryForgetInput | null>(null);
  const update = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, enabled: boolean): Promise<void> => {
        let input = updateAttempt.current;
        if (
          input === null ||
          input.enabled !== enabled ||
          input.expectedRevision !== entry.revision
        ) {
          input = {
            requestId: crypto.randomUUID(),
            expectedRevision: entry.revision,
            category: entry.category,
            body: entry.body,
            enabled,
            mode: entry.mode,
          };
          updateAttempt.current = input;
        }
        try {
          const result = await updateMemory(entry.id, input, signal);
          signal.throwIfAborted();
          if (result.entry === null) throw new Error('记忆已被忘记，请刷新列表。');
          updateAttempt.current = null;
          onChanged();
        } finally {
          await refreshMemoryFacts(client);
        }
      },
      [client, entry, onChanged],
    ),
  );
  const forget = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        let input = forgetAttempt.current;
        if (input === null || input.expectedRevision !== entry.revision) {
          input = { requestId: crypto.randomUUID(), expectedRevision: entry.revision };
          forgetAttempt.current = input;
        }
        try {
          await forgetMemory(entry.id, input, signal);
          signal.throwIfAborted();
          client.setQueriesData<MemoryPage>({ queryKey: ['memories'] }, (page) => {
            if (page === undefined) return page;
            const items = page.items.filter((item) => {
              return item.id !== entry.id;
            });
            if (items.length === page.items.length) return page;
            return { ...page, items, total: Math.max(0, page.total - 1) };
          });
          onChanged();
          setForgetting(false);
        } finally {
          await refreshMemoryFacts(client);
        }
      },
      [client, entry.id, entry.revision, onChanged],
    ),
  );
  const edit = useCallback((): void => {
    onEdit(entry);
  }, [entry, onEdit]);
  const openForget = useCallback((): void => {
    setForgetting(true);
  }, []);
  const changeForgetting = useCallback(
    (open: boolean): void => {
      if (!forget.pending) setForgetting(open);
    },
    [forget.pending],
  );
  return {
    edit,
    changeEnabled: update.run,
    update,
    forgetting,
    openForget,
    changeForgetting,
    forget,
  };
};
