import type { SessionArchiveJob } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect } from 'react';
import { fetchArchiveJob } from '@/features/archives/services/archives';
import { archiveIsActive, mergeArchiveJob } from '@/features/archives/utils/archive-view';
import { useArchiveStore } from '@/features/archives/stores/archives';

/** Safe GET polling also resolves uncertain POST reception without repeating side effects. */
export const useArchiveJob = (
  operationId: string | null,
): UseQueryResult<SessionArchiveJob, Error> => {
  const client = useQueryClient();
  const commitIntent = useArchiveStore((state) => {
    if (operationId === null) return undefined;
    return state.commitIntents[operationId];
  });
  const confirmCommit = useArchiveStore((state) => {
    return state.confirmCommit;
  });
  const query = useQuery({
    queryKey: ['archive-job', operationId],
    queryFn: async ({ signal }): Promise<SessionArchiveJob> => {
      if (operationId === null) throw new Error('尚未选择归档操作。');
      const job = await fetchArchiveJob(operationId, signal);
      if (!signal.aborted && job.kind === 'import' && job.status === 'completed')
        await client.invalidateQueries({ queryKey: ['sessions'] });
      return mergeArchiveJob(
        client.getQueryData<SessionArchiveJob>(['archive-job', operationId]),
        job,
      );
    },
    enabled: operationId !== null,
    retry: false,
    gcTime: 0,
    refetchInterval: (current): number | false => {
      if (current.state.data === undefined && operationId !== null) return 1500;
      if (commitIntent !== undefined) return 1000;
      if (current.state.data !== undefined && archiveIsActive(current.state.data)) return 1000;
      return false;
    },
  });
  useEffect(() => {
    const status = query.data?.status;
    if (operationId !== null && status !== undefined && status !== 'running' && status !== 'ready')
      confirmCommit(operationId);
  }, [confirmCommit, operationId, query.data?.status]);
  return query;
};
