import type {
  SearchSourceSelection,
  SearchWindowCursor,
  SessionSnapshot,
} from '@my-pi-harness/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useNavigationStore } from '@/app/stores/navigation';
import { fetchSearchSource } from '@/features/search/services/search';
import type { SourceReaderAction, SourceReaderState } from '@/features/search/types/search';
import { sourceSelectionKey } from '@/features/search/utils/search';
import { useComposerStore } from '@/features/sessions/stores/composer';
import { useTimelineStore } from '@/features/sessions/stores/timeline';
import { useAsyncEvent } from '@/hooks/use-async-event';
import type { Action } from '@/types/events';
import { quotedSourceText, verifiedTimelineTarget } from '@/features/search/utils/source-text';

type SourceReaderPage =
  | { kind: 'selection' }
  | { kind: 'messages'; cursor: SearchWindowCursor }
  | { kind: 'text'; offset: number };

/** Exact source windows never select a branch or traverse a task from its first transcript page. */
export const useSourceReader = (
  ownerId: string,
  selection: SearchSourceSelection,
  active: SessionSnapshot | undefined,
  onClose: Action,
): SourceReaderState => {
  const client = useQueryClient();
  const [page, setPage] = useState<SourceReaderPage>({ kind: 'selection' });
  const query = useQuery({
    queryKey: ['search-source', ownerId, selection, page],
    meta: { memorySource: selection.source.kind === 'memory' },
    queryFn: ({ signal }) => {
      if (page.kind === 'messages')
        return fetchSearchSource({ selection, before: 2, after: 2, cursor: page.cursor }, signal);
      if (page.kind === 'text')
        return fetchSearchSource(
          { selection, before: 0, after: 0, textOffset: page.offset },
          signal,
        );
      return fetchSearchSource({ selection, before: 2, after: 2 }, signal);
    },
  });
  const addQuote = useComposerStore((state) => {
    return state.addSearchQuote;
  });
  const generation = useComposerStore((state) => {
    return state.newConversationGeneration;
  });
  const sessionId = useNavigationStore((state) => {
    return state.activeSessionId;
  });
  const navigate = useNavigationStore((state) => {
    return state.navigate;
  });
  const locateMessage = useTimelineStore((state) => {
    return state.locate;
  });
  const previous = useCallback((): void => {
    if (query.data?.previous !== null && query.data?.previous !== undefined) {
      setPage({ kind: 'messages', cursor: query.data.previous });
    }
  }, [query.data?.previous]);
  const next = useCallback((): void => {
    if (query.data?.next !== null && query.data?.next !== undefined) {
      setPage({ kind: 'messages', cursor: query.data.next });
    }
  }, [query.data?.next]);
  const anchor = query.data?.items.find((item) => {
    return (
      sourceSelectionKey({ ...item, start: selection.start, end: selection.end }) ===
      sourceSelectionKey(selection)
    );
  });
  const previousText = useCallback((): void => {
    if (anchor === undefined || anchor.start <= 0) return;
    setPage({ kind: 'text', offset: Math.max(0, anchor.start - 8000) });
  }, [anchor]);
  const nextText = useCallback((): void => {
    if (anchor === undefined || anchor.end >= anchor.totalLength) return;
    setPage({ kind: 'text', offset: anchor.end });
  }, [anchor]);
  const target = selection.target;
  const canLocate =
    !query.isError &&
    !query.isFetching &&
    query.data !== undefined &&
    !query.data.archived &&
    !query.data.historicalBranch &&
    target.kind === 'message' &&
    target.taskId === undefined &&
    active !== undefined &&
    target.sessionId === active.session.id &&
    target.branchId === active.session.activeBranchId &&
    active.messages.some((message) => {
      return message.id === target.messageId && message.agentMessageId === undefined;
    });
  const action = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, operation: SourceReaderAction): Promise<void> => {
        if (operation.kind === 'quote') {
          let key = `new:${generation}`;
          if (sessionId !== null) key = sessionId;
          addQuote(key, operation.selection);
          navigate('sessions');
          onClose();
          return;
        }
        if (!canLocate || active === undefined || target.kind !== 'message')
          throw new Error('该来源只能在只读窗口中查看。');
        const readCurrent = (): SessionSnapshot | undefined => {
          return client.getQueryData<SessionSnapshot>(['session', target.sessionId]);
        };
        const verified = await verifiedTimelineTarget(selection, active, readCurrent, signal);
        locateMessage(verified.sessionId, {
          id: crypto.randomUUID(),
          branchId: verified.branchId,
          messageId: verified.messageId,
        });
        onClose();
      },
      [
        active,
        addQuote,
        canLocate,
        client,
        generation,
        locateMessage,
        navigate,
        onClose,
        selection,
        sessionId,
        target,
      ],
    ),
  );
  const { run } = action;
  const quote = useCallback(
    (reference: SearchSourceSelection): void => {
      run({ kind: 'quote', selection: reference });
    },
    [run],
  );
  const locate = useCallback((): void => {
    run({ kind: 'locate' });
  }, [run]);
  const quoteSelected = useCallback((): void => {
    run({ kind: 'quote', selection });
  }, [run, selection]);
  let selectedText: string | null = null;
  if (query.data !== undefined && selection.end - selection.start <= 8000)
    selectedText = quotedSourceText(query.data, selection);
  return {
    query,
    previous,
    next,
    previousText,
    nextText,
    canPreviousText: page.kind !== 'messages' && anchor !== undefined && anchor.start > 0,
    canNextText:
      page.kind !== 'messages' && anchor !== undefined && anchor.end < anchor.totalLength,
    action,
    quote,
    quoteSelected,
    selectedText,
    locate,
    canLocate,
  };
};
