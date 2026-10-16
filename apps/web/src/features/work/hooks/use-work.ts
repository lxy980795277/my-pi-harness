import type { WorkView } from '@/features/work/types/work';
import type {
  QuestionResponse,
  SessionSnapshot,
  WorkPatch,
  WorkSnapshot,
} from '@my-pi-harness/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { answerQuestion, commandWork, fetchWork, patchWork } from '@/features/work/services/work';
import { retainWorkSnapshot } from '@/features/work/utils/work-view';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { useRequestTask } from '@/hooks/use-request-task';

/** Branch-scoped Query owns work facts; active-run polling also recovers question events after reconnect. */
export const useWork = (session: SessionSnapshot): WorkView => {
  const id = session.session.id;
  const branchId = session.session.activeBranchId;
  const running = session.session.activeRunId !== null;
  const client = useQueryClient();
  const task = useRequestTask();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('context');
  const query = useQuery({
    queryKey: ['work', id, branchId],
    queryFn: ({ signal }) => {
      return fetchWork(id, branchId, signal);
    },
    refetchInterval: running && 1500,
    structuralSharing: retainWorkSnapshot,
  });
  const execute = useCallback(
    async (operation: (signal: AbortSignal) => Promise<WorkSnapshot>): Promise<void> => {
      try {
        const snapshot = await task(operation);
        client.setQueryData(['work', id, snapshot.state.branchId], snapshot);
      } finally {
        await Promise.all([
          client.invalidateQueries({ queryKey: ['work', id] }),
          client.invalidateQueries({ queryKey: ['session', id] }),
          client.invalidateQueries({ queryKey: ['sessions'] }),
        ]);
      }
    },
    [client, id, task],
  );
  const patch = useCallback(
    async (input: WorkPatch): Promise<void> => {
      return execute((signal) => {
        return patchWork(id, input, signal);
      });
    },
    [execute, id],
  );
  const command = useCallback(
    async (name: string, input: unknown): Promise<void> => {
      return execute((signal) => {
        return commandWork(id, name, input, signal);
      });
    },
    [execute, id],
  );
  const answer = useCallback(
    async (questionId: string, value: QuestionResponse[] | null): Promise<void> => {
      return execute((signal) => {
        return answerQuestion(id, questionId, value, signal);
      });
    },
    [execute, id],
  );
  const { run: refresh } = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await client.invalidateQueries({ queryKey: ['work', id, branchId] });
    }, [branchId, client, id]),
  );
  const show = useCallback((): void => {
    setOpen(true);
    refresh();
  }, [refresh]);
  return { query, running, open, setOpen, tab, setTab, show, patch, command, answer };
};
