import type { ConversationState } from '@/features/sessions/types/session';
import { useCallback, useMemo } from 'react';
import { conversationMessages } from '@/features/sessions/utils/conversation-view';
import { useSession } from '@/features/sessions/hooks/use-session';
import { useSessionCommands } from '@/features/sessions/hooks/use-session-commands';
import { fetchSessionLog } from '@/features/sessions/services/sessions';
import { useBlobDownload } from '@/hooks/use-blob-download';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Owns the selected session's commands and cancellable log download. */
export const useConversation = (sessionId: string): ConversationState => {
  const state = useSession(sessionId);
  const commands = useSessionCommands(sessionId);
  const { refetch } = state.query;
  const download = useBlobDownload(
    sessionId,
    useCallback(
      (signal: AbortSignal): Promise<Blob> => {
        return fetchSessionLog(sessionId, signal);
      },
      [sessionId],
    ),
    `${sessionId}.jsonl`,
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
