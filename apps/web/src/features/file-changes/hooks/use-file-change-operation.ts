import type { FileChangeBatchInput, FileChangeBatchReceipt } from '@my-pi-harness/protocol';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import {
  cancelFileChangeBatch,
  fetchFileChangeBatch,
  fileChangeWasNotAccepted,
  submitFileChangeBatch,
} from '@/features/file-changes/services/file-changes';
import { useFileChangesStore } from '@/features/file-changes/stores/file-changes';
import {
  batchIsRunning,
  mergeFileChangeReceipt,
} from '@/features/file-changes/utils/file-change-view';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { RequestError } from '@/services/base-request';

interface FileChangeOperationState {
  operationId: string | undefined;
  query: UseQueryResult<FileChangeBatchReceipt, Error>;
  unconfirmed: FileChangeBatchInput | undefined;
  pending: boolean;
  error: string | null;
  receptionUnknown: boolean;
  canCancel: boolean;
  blocked: boolean;
  submit: (
    action: FileChangeBatchInput['action'],
    selection: FileChangeBatchInput['selection'],
  ) => void;
  retrySubmission: () => void;
  refresh: () => void;
  cancel: () => void;
  inspectUnconfirmed: () => void;
  stopTracking: () => void;
}

/** A stable intent survives uncertain transport; only GET or a validated receipt confirms acceptance. */
export const useFileChangeOperation = (
  sessionId: string,
  canOperate: boolean,
): FileChangeOperationState => {
  const client = useQueryClient();
  const operationId = useFileChangesStore((state) => {
    return state.operationIds[sessionId];
  });
  const unconfirmed = useFileChangesStore((state) => {
    return state.unconfirmed[sessionId];
  });
  const begin = useFileChangesStore((state) => {
    return state.begin;
  });
  const acknowledge = useFileChangesStore((state) => {
    return state.acknowledge;
  });
  const inspect = useFileChangesStore((state) => {
    return state.inspect;
  });
  const stopTrackingStore = useFileChangesStore((state) => {
    return state.stopTracking;
  });
  const invalidate = useCallback(async (): Promise<void> => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['file-changes', sessionId] }),
      client.invalidateQueries({ queryKey: ['file-change-detail', sessionId] }),
      client.invalidateQueries({ queryKey: ['file-change-history', sessionId] }),
    ]);
  }, [client, sessionId]);
  const query = useQuery({
    queryKey: ['file-change-operation', sessionId, operationId],
    queryFn: async ({ signal }): Promise<FileChangeBatchReceipt> => {
      if (operationId === undefined) throw new Error('尚未选择文件操作。');
      const receipt = await fetchFileChangeBatch(sessionId, operationId, signal);
      if (!signal.aborted && !batchIsRunning(receipt)) await invalidate();
      return mergeFileChangeReceipt(
        client.getQueryData<FileChangeBatchReceipt>([
          'file-change-operation',
          sessionId,
          operationId,
        ]),
        receipt,
      );
    },
    enabled: operationId !== undefined,
    retry: false,
    gcTime: 0,
    refetchInterval: (current): number | false => {
      if (current.state.data !== undefined && batchIsRunning(current.state.data)) return 1000;
      if (unconfirmed !== undefined && unconfirmed.operationId === operationId) return 1500;
      return false;
    },
  });
  useEffect(() => {
    if (query.data !== undefined) acknowledge(sessionId, query.data.operationId);
  }, [acknowledge, query.data, sessionId]);
  const submission = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, input: FileChangeBatchInput): Promise<void> => {
        let receipt: FileChangeBatchReceipt;
        try {
          receipt = await submitFileChangeBatch(sessionId, input, signal);
        } catch (failure: unknown) {
          if (!signal.aborted && fileChangeWasNotAccepted(failure))
            stopTrackingStore(sessionId, input.operationId);
          throw failure;
        }
        if (signal.aborted) return;
        client.setQueryData<FileChangeBatchReceipt>(
          ['file-change-operation', sessionId, input.operationId],
          (current) => {
            return mergeFileChangeReceipt(current, receipt);
          },
        );
        acknowledge(sessionId, input.operationId);
        await invalidate();
      },
      [acknowledge, client, invalidate, sessionId, stopTrackingStore],
    ),
  );
  const submitRun = submission.run;
  const submit = useCallback(
    (
      action: FileChangeBatchInput['action'],
      selection: FileChangeBatchInput['selection'],
    ): void => {
      if (!canOperate || unconfirmed !== undefined || submission.pending) return;
      const input: FileChangeBatchInput = { operationId: crypto.randomUUID(), action, selection };
      begin(sessionId, input);
      submitRun(input);
    },
    [begin, canOperate, sessionId, submission.pending, submitRun, unconfirmed],
  );
  const retrySubmission = useCallback((): void => {
    if (canOperate && unconfirmed !== undefined) submitRun(unconfirmed);
  }, [canOperate, submitRun, unconfirmed]);
  const cancellation = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (query.data === undefined || !batchIsRunning(query.data) || query.data.cancelRequested)
          return;
        const receipt = await cancelFileChangeBatch(sessionId, query.data.operationId, signal);
        if (signal.aborted) return;
        client.setQueryData<FileChangeBatchReceipt>(
          ['file-change-operation', sessionId, receipt.operationId],
          (current) => {
            return mergeFileChangeReceipt(current, receipt);
          },
        );
        await invalidate();
      },
      [client, invalidate, query.data, sessionId],
    ),
  );
  const refresh = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await query.refetch();
    }, [query]),
  );
  let error = submission.error;
  if (cancellation.error !== null) error = cancellation.error;
  const receptionUnknown =
    query.data === undefined && query.error instanceof RequestError && query.error.status === 404;
  const canCancel =
    query.data !== undefined && batchIsRunning(query.data) && !query.data.cancelRequested;
  const blocked =
    !canOperate ||
    unconfirmed !== undefined ||
    (query.data !== undefined && batchIsRunning(query.data));
  const inspectUnconfirmed = useCallback((): void => {
    if (unconfirmed !== undefined) inspect(sessionId, unconfirmed.operationId);
  }, [inspect, sessionId, unconfirmed]);
  const stopTracking = useCallback((): void => {
    if (unconfirmed !== undefined) stopTrackingStore(sessionId, unconfirmed.operationId);
  }, [sessionId, stopTrackingStore, unconfirmed]);
  return {
    operationId,
    query,
    unconfirmed,
    pending: submission.pending || cancellation.pending,
    error,
    receptionUnknown,
    canCancel,
    blocked,
    submit,
    retrySubmission,
    refresh: refresh.run,
    cancel: cancellation.run,
    inspectUnconfirmed,
    stopTracking,
  };
};
