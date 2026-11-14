import {
  SESSION_ARCHIVE_MAXIMUM_UPLOAD_BYTES,
  type SessionArchiveJob,
} from '@my-pi-harness/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { useArchiveJob } from '@/features/archives/hooks/use-archive-job';
import {
  cancelArchiveJob,
  commitSessionArchive,
  downloadSessionArchive,
  startArchiveExport,
  uploadSessionArchive,
} from '@/features/archives/services/archives';
import { useArchiveStore } from '@/features/archives/stores/archives';
import { archiveCanCancel, mergeArchiveJob } from '@/features/archives/utils/archive-view';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { useBlobDownload } from '@/hooks/use-blob-download';
import { useNavigationStore } from '@/app/stores/navigation';
import { RequestError } from '@/services/base-request';

interface ArchiveTransferState {
  query: ReturnType<typeof useArchiveJob>;
  operationId: string | null;
  fileName: string | null;
  input: RefObject<HTMLInputElement | null>;
  choose: () => void;
  changeFile: (event: ChangeEvent<HTMLInputElement>) => void;
  upload: () => void;
  exportArchive: () => void;
  commit: () => void;
  cancel: () => void;
  refresh: () => void;
  startNew: () => void;
  download: () => void;
  readSession: () => void;
  bindSession: () => void;
  changeOpen: (open: boolean) => void;
  pending: boolean;
  downloading: boolean;
  closing: boolean;
  error: string | null;
  commitUnconfirmed: boolean;
  missing: boolean;
}

/** File bytes stay in the mounted upload owner; only stable operation IDs survive dialog closure. */
export const useArchiveTransfer = (): ArchiveTransferState => {
  const client = useQueryClient();
  const mode = useArchiveStore((state) => {
    return state.mode;
  });
  const sessionId = useArchiveStore((state) => {
    return state.sessionId;
  });
  const operationId = useArchiveStore((state) => {
    return state.operationId;
  });
  const commitIntent = useArchiveStore((state) => {
    if (state.operationId === null) return undefined;
    return state.commitIntents[state.operationId];
  });
  const track = useArchiveStore((state) => {
    return state.track;
  });
  const rememberCommit = useArchiveStore((state) => {
    return state.rememberCommit;
  });
  const closeStore = useArchiveStore((state) => {
    return state.close;
  });
  const startNewStore = useArchiveStore((state) => {
    return state.startNew;
  });
  const openBinding = useArchiveStore((state) => {
    return state.openBinding;
  });
  const selectSession = useNavigationStore((state) => {
    return state.selectSession;
  });
  const query = useArchiveJob(operationId);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const receive = useCallback(
    async (job: SessionArchiveJob, signal: AbortSignal): Promise<void> => {
      if (signal.aborted) return;
      client.setQueryData<SessionArchiveJob>(['archive-job', job.operationId], (current) => {
        return mergeArchiveJob(current, job);
      });
      await client.invalidateQueries({ queryKey: ['archive-jobs'] });
      if (job.kind === 'import' && job.status === 'completed')
        await client.invalidateQueries({ queryKey: ['sessions'] });
    },
    [client],
  );
  const transfer = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, action: 'export' | 'upload' | 'commit'): Promise<void> => {
        const id = operationId ?? crypto.randomUUID();
        if (action === 'export') {
          if (sessionId === null) throw new Error('尚未选择导出会话。');
          track('export', sessionId, id);
          await receive(await startArchiveExport(sessionId, id, signal), signal);
          return;
        }
        if (action === 'upload') {
          if (file === null) throw new Error('请先选择完整归档文件。');
          track('import', null, id);
          await receive(await uploadSessionArchive(id, file, signal), signal);
          return;
        }
        const job = query.data;
        if (
          operationId === null ||
          job?.preview?.canImport !== true ||
          job.archiveSha256 === null ||
          job.status !== 'ready'
        )
          throw new Error('请先完成归档预检。');
        rememberCommit(operationId, job.archiveSha256);
        await receive(await commitSessionArchive(operationId, job.archiveSha256, signal), signal);
      },
      [file, operationId, query.data, receive, rememberCommit, sessionId, track],
    ),
  );
  const runTransfer = transfer.run;
  const exportArchive = useCallback((): void => {
    runTransfer('export');
  }, [runTransfer]);
  const upload = useCallback((): void => {
    runTransfer('upload');
  }, [runTransfer]);
  const commit = useCallback((): void => {
    runTransfer('commit');
  }, [runTransfer]);
  const cancellation = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (operationId === null || query.data === undefined || !archiveCanCancel(query.data))
          return;
        await receive(await cancelArchiveJob(operationId, signal), signal);
      },
      [operationId, query.data, receive],
    ),
  );
  const refresh = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await query.refetch();
    }, [query]),
  );
  const newTransfer = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (operationId !== null && query.data !== undefined && archiveCanCancel(query.data))
          await receive(await cancelArchiveJob(operationId, signal), signal);
        signal.throwIfAborted();
        setFile(null);
        setFileError(null);
        startNewStore();
      },
      [operationId, query.data, receive, startNewStore],
    ),
  );
  const download = useBlobDownload(
    operationId ?? 'no-archive',
    useCallback(
      (signal: AbortSignal): Promise<Blob> => {
        if (operationId === null) throw new Error('尚未选择导出操作。');
        return downloadSessionArchive(operationId, signal);
      },
      [operationId],
    ),
    (query.data?.sessionId ?? 'session') + '.tar.gz',
  );
  const closing = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        transfer.cancel();
        download.cancel();
        try {
          if (operationId !== null && query.data !== undefined && archiveCanCancel(query.data))
            await receive(await cancelArchiveJob(operationId, signal), signal);
        } finally {
          if (!signal.aborted) closeStore();
        }
      },
      [closeStore, download, operationId, query.data, receive, transfer],
    ),
  );
  const closeRun = closing.run;
  const changeOpen = useCallback(
    (open: boolean): void => {
      if (!open) closeRun();
    },
    [closeRun],
  );
  const choose = useCallback((): void => {
    input.current?.click();
  }, []);
  const changeFile = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    const selected = event.currentTarget.files?.item(0) ?? null;
    event.currentTarget.value = '';
    setFileError(null);
    if (selected !== null && selected.size > SESSION_ARCHIVE_MAXIMUM_UPLOAD_BYTES) {
      setFile(null);
      setFileError('压缩归档不能超过 256 MiB。');
      return;
    }
    setFile(selected);
  }, []);
  const readSession = useCallback((): void => {
    const id = query.data?.sessionId;
    if (id === undefined || id === null || query.data?.status !== 'completed') return;
    selectSession(id);
    closeStore();
  }, [closeStore, query.data, selectSession]);
  const bindSession = useCallback((): void => {
    const id = query.data?.sessionId;
    if (id !== undefined && id !== null && query.data?.status === 'completed') openBinding(id);
  }, [openBinding, query.data]);
  let error = fileError;
  for (const failure of [transfer.error, cancellation.error, newTransfer.error, download.error])
    if (failure !== null) error = failure;
  if (mode === 'history' && operationId === null) error = null;
  return {
    query,
    operationId,
    fileName: file?.name ?? null,
    input,
    choose,
    changeFile,
    upload,
    exportArchive,
    commit,
    cancel: cancellation.run,
    refresh: refresh.run,
    startNew: newTransfer.run,
    download: download.run,
    readSession,
    bindSession,
    changeOpen,
    pending: transfer.pending || cancellation.pending || newTransfer.pending,
    downloading: download.pending,
    closing: closing.pending,
    error,
    commitUnconfirmed: commitIntent !== undefined,
    missing: query.error instanceof RequestError && query.error.status === 404,
  };
};
