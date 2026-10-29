import type { ConversationState } from '@/features/sessions/types/session';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { conversationMessages } from '@/features/sessions/utils/conversation-view';
import { useSession } from '@/features/sessions/hooks/use-session';
import { useSessionCommands } from '@/features/sessions/hooks/use-session-commands';
import { fetchSessionLog } from '@/features/sessions/services/sessions';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Owns the selected session's commands and cancellable log download. */
export const useConversation = (sessionId: string): ConversationState => {
  const state = useSession(sessionId);
  const commands = useSessionCommands(sessionId);
  const { refetch } = state.query;
  const downloadUrl = useRef<string | null>(null);
  const releaseTimer = useRef<number | null>(null);
  const releaseDownload = useCallback((): void => {
    if (releaseTimer.current !== null) {
      window.clearTimeout(releaseTimer.current);
      releaseTimer.current = null;
    }
    if (downloadUrl.current !== null) {
      URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = null;
    }
  }, []);
  useEffect(() => {
    return releaseDownload;
  }, [releaseDownload]);
  const download = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        const log = await fetchSessionLog(sessionId, signal);
        signal.throwIfAborted();
        releaseDownload();
        downloadUrl.current = URL.createObjectURL(log);
        const link = document.createElement('a');
        link.href = downloadUrl.current;
        link.download = `${sessionId}.jsonl`;
        document.body.append(link);
        try {
          link.click();
        } catch (error: unknown) {
          releaseDownload();
          throw error;
        } finally {
          link.remove();
        }
        // Chromium needs the object URL beyond click dispatch to consume the file.
        releaseTimer.current = window.setTimeout(releaseDownload, 1_000);
      },
      [releaseDownload, sessionId],
    ),
  );
  const reload = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await refetch();
    }, [refetch]),
  );
  const source = state.query.data;
  const sourceMessages = source?.messages;
  const messages = useMemo(() => {
    if (sourceMessages === undefined) return undefined;
    return conversationMessages(sourceMessages);
  }, [sourceMessages]);
  const snapshot = useMemo(() => {
    if (source === undefined || messages === undefined) return undefined;
    if (messages === source.messages) return source;
    return { ...source, messages };
  }, [messages, source]);
  let error = download.error;
  if (error === null) {
    error = reload.error;
  }
  return {
    ...state,
    commands,
    snapshot,
    lastRun: snapshot?.runs.at(-1),
    download: download.run,
    downloading: download.pending,
    reload: reload.run,
    error,
  };
};
