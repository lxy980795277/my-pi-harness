import type { SessionSummary, WorkSnapshot } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { fetchWork, patchWork } from '@/features/work/services/work';
import { retainWorkSnapshot } from '@/features/work/utils/work-view';
import type { ComposerWorkMode } from '@/features/work/types/work';
import type { WorkMode } from '@/features/sessions/types/composer';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** The input bar and work dialog share the same branch-local server query. */
export const useComposerWorkMode = (session: SessionSummary): ComposerWorkMode => {
  const client = useQueryClient();
  const queryKey = ['work', session.id, session.activeBranchId];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }): Promise<WorkSnapshot> => {
      return fetchWork(session.id, session.activeBranchId, signal);
    },
    structuralSharing: retainWorkSnapshot,
  });
  const state = query.data?.state;
  const update = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, mode: WorkMode): Promise<void> => {
        if (!state || session.activeRunId !== null) {
          return;
        }
        try {
          const snapshot = await patchWork(
            session.id,
            { expectedBranchId: state.branchId, revision: state.revision, mode },
            signal,
          );
          client.setQueryData(['work', session.id, snapshot.state.branchId], snapshot);
        } finally {
          await client.invalidateQueries({ queryKey: ['work', session.id] });
        }
      },
      [client, session.activeRunId, session.id, state],
    ),
  );
  const { run } = update;
  const change = useCallback(
    (value: string): void => {
      if (value === 'execute' || value === 'plan') {
        run(value);
      }
    },
    [run],
  );
  let error = update.error;
  if (error === null && query.error !== null) {
    error = query.error.message;
  }
  let mode: WorkMode = 'execute';
  if (state) {
    mode = state.mode;
  }
  return {
    sendingBlocked: query.isPending || update.pending,
    mode,
    disabled: !state || session.activeRunId !== null || update.pending,
    change,
    error,
  };
};
