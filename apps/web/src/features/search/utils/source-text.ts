import type {
  SearchSourceSelection,
  SearchSourceWindow,
  SessionSnapshot,
} from '@my-pi-harness/protocol';
import { sourceSelectionKey } from '@/features/search/utils/search';

/** A preview is sliced only from the exact returned source membership and UTF-16 range. */
export const quotedSourceText = (
  window: SearchSourceWindow,
  selection: SearchSourceSelection,
): string | null => {
  for (const item of window.items) {
    if (
      sourceSelectionKey({ ...item, start: selection.start, end: selection.end }) !==
      sourceSelectionKey(selection)
    )
      continue;
    if (selection.start < item.start || selection.end > item.end) continue;
    return item.text.slice(selection.start - item.start, selection.end - item.start);
  }
  return null;
};

/** A current-timeline shortcut requires the exact full source text, never a matching id or excerpt alone. */
export const sourceMatchesCurrentMessage = async (
  selection: SearchSourceSelection,
  snapshot: SessionSnapshot,
): Promise<boolean> => {
  const target = selection.target;
  if (
    selection.source.kind !== 'message' ||
    target.kind !== 'message' ||
    target.taskId !== undefined ||
    target.sessionId !== snapshot.session.id ||
    target.branchId !== snapshot.session.activeBranchId
  )
    return false;
  const message = snapshot.messages.find((item) => {
    return item.id === target.messageId;
  });
  if (
    message === undefined ||
    message.agentMessageId !== undefined ||
    message.status === 'streaming'
  )
    return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message.text));
  const hash = Array.from(new Uint8Array(digest), (value) => {
    return value.toString(16).padStart(2, '0');
  }).join('');
  return hash === selection.source.contentHash;
};

/** A source shortcut rechecks the newest snapshot after hashing before handing an id to the virtual list. */
export const verifiedTimelineTarget = async (
  selection: SearchSourceSelection,
  initial: SessionSnapshot,
  readCurrent: () => SessionSnapshot | undefined,
  signal: AbortSignal,
): Promise<Extract<SearchSourceSelection['target'], { kind: 'message' }>> => {
  const target = selection.target;
  if (target.kind !== 'message' || !(await sourceMatchesCurrentMessage(selection, initial)))
    throw new Error('当前对话中的原文已变化，请继续在只读窗口查看。');
  signal.throwIfAborted();
  const expected = initial.messages.find((message) => {
    return message.id === target.messageId;
  });
  const latest = readCurrent();
  const current = latest?.messages.find((message) => {
    return message.id === target.messageId;
  });
  if (
    expected === undefined ||
    current === undefined ||
    current.status === 'streaming' ||
    current.text !== expected.text ||
    latest?.session.id !== target.sessionId ||
    latest.session.activeBranchId !== target.branchId
  )
    throw new Error('当前对话已变化，请继续在只读窗口查看。');
  return target;
};
