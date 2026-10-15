import type { SessionSummary, WorkSnapshot } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { fetchWork, patchWork } from '@/features/work/services/work';
import { retainWorkSnapshot } from '@/features/work/utils/work-view';
import { useAsyncEvent } from '@/hooks/use-async-event';

interface ComposerWorkMode {
  mode: 'execute' | 'plan';
  disabled: boolean;
  sendingBlocked: boolean;
  change: (value: string) => void;
  error: string | null;
}
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
      async (signal: AbortSignal, mode: 'execute' | 'plan'): Promise<void> => {
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
  return {
    sendingBlocked: query.isPending || update.pending,
    mode: state?.mode ?? 'execute',
    disabled: !state || session.activeRunId !== null || update.pending,
    change,
    error: update.error ?? query.error?.message ?? null,
  };
};
