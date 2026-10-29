import type {
  MessageView,
  SessionChange,
  SessionSnapshot,
  SessionStreamUpdate,
} from '@my-pi-harness/protocol';
import { isNewerSnapshot } from '@/utils/snapshot-position';

interface SessionEntity {
  id: string;
  sessionId: string;
}

const verifyCollection = (items: SessionEntity[], sessionId: string): void => {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.sessionId !== sessionId || ids.has(item.id)) {
      throw new Error('会话状态包含不一致或重复的条目。');
    }
    ids.add(item.id);
  }
};

/** Checks associations that JSON field validation alone cannot establish. */
export const verifySessionSnapshot = (snapshot: SessionSnapshot, sessionId: string): void => {
  if (snapshot.session.id !== sessionId || snapshot.snapshotSeq !== snapshot.session.snapshotSeq) {
    throw new Error('会话事件的标识或序号不一致。');
  }
  for (const items of [
    snapshot.messages,
    snapshot.branches,
    snapshot.runs,
    snapshot.queue,
    snapshot.tools,
  ]) {
    verifyCollection(items, sessionId);
  }
  if (
    !snapshot.branches.some(({ id }) => {
      return id === snapshot.session.activeBranchId;
    })
  ) {
    throw new Error('会话状态缺少当前分支。');
  }
};

const setEntry = <T extends SessionEntity>(
  items: T[],
  incoming: T,
  index: number,
  sessionId: string,
): T[] => {
  if (incoming.sessionId !== sessionId || index > items.length) {
    throw new Error('会话增量条目的所属或位置无效。');
  }
  const existing = items.findIndex(({ id }) => {
    return id === incoming.id;
  });
  const updated = [...items];
  if (existing === -1) {
    updated.splice(index, 0, incoming);
    return updated;
  }
  if (existing !== index) {
    throw new Error('会话增量改变了既有条目的顺序。');
  }
  updated[index] = incoming;
  return updated;
};

const removeEntry = <T extends SessionEntity>(items: T[], id: string): T[] => {
  if (
    !items.some((item) => {
      return item.id === id;
    })
  ) {
    throw new Error('会话增量删除了不存在的条目。');
  }
  return items.filter((item) => {
    return item.id !== id;
  });
};

const appendMessage = (
  messages: MessageView[],
  change: Extract<SessionChange, { type: 'message.append' }>,
): MessageView[] => {
  const index = messages.findIndex(({ id }) => {
    return id === change.id;
  });
  const message = messages[index];
  if (!message || message.status !== 'streaming') {
    throw new Error('会话增量缺少正在生成的目标消息。');
  }
  const text = message.text + change.textDelta;
  const thinking = message.thinking + change.thinkingDelta;
  if (text.length > 2_000_000 || thinking.length > 2_000_000) {
    throw new Error('会话增量超过消息长度上限。');
  }
  const updated = [...messages];
  updated[index] = { ...message, text, thinking };
  return updated;
};

const changeIdentity = (change: SessionChange): string => {
  switch (change.type) {
    case 'message.set':
      return `message:${change.message.id}`;
    case 'branch.set':
      return `branch:${change.branch.id}`;
    case 'run.set':
      return `run:${change.run.id}`;
    case 'queue.set':
      return `queue:${change.input.id}`;
    case 'tool.set':
      return `tool:${change.tool.id}`;
    default:
      return `${change.type.split('.')[0]}:${change.id}`;
  }
};

const unsupportedChange = (_change: never): never => {
  throw new Error('会话增量包含未支持的操作。');
};

/** Applies an exact recorded/live interval atomically; gaps require a fresh baseline. */
export const applySessionStreamUpdate = (
  current: SessionSnapshot | undefined,
  update: SessionStreamUpdate,
  sessionId: string,
): SessionSnapshot => {
  if (update.kind === 'snapshot') {
    verifySessionSnapshot(update.snapshot, sessionId);
    if (current && !isNewerSnapshot(update.snapshot, current)) {
      return current;
    }
    return update.snapshot;
  }
  if (
    update.sessionId !== sessionId ||
    update.session.id !== sessionId ||
    update.session.snapshotSeq !== update.snapshotSeq ||
    update.session.activeBranchId !== update.branchId ||
    !isNewerSnapshot(update, {
      snapshotSeq: update.baseSeq,
      liveRevision: update.baseLiveRevision,
    })
  ) {
    throw new Error('会话增量的标识、分支或序号不一致。');
  }
  if (current && !isNewerSnapshot(update, current)) {
    return current;
  }
  if (
    !current ||
    current.session.id !== sessionId ||
    current.snapshotSeq !== update.baseSeq ||
    current.liveRevision !== update.baseLiveRevision ||
    current.session.activeBranchId !== update.branchId
  ) {
    throw new Error('会话增量出现缺口，需要重新同步。');
  }
  let { messages, branches, runs, queue, tools } = current;
  const changed = new Set<string>();
  for (const change of update.changes) {
    const identity = changeIdentity(change);
    if (changed.has(identity)) {
      throw new Error('会话增量重复修改了同一条目。');
    }
    changed.add(identity);
    switch (change.type) {
      case 'message.set':
        messages = setEntry(messages, change.message, change.index, sessionId);
        break;
      case 'message.append':
        messages = appendMessage(messages, change);
        break;
      case 'message.remove':
        messages = removeEntry(messages, change.id);
        break;
      case 'branch.set':
        branches = setEntry(branches, change.branch, change.index, sessionId);
        break;
      case 'branch.remove':
        branches = removeEntry(branches, change.id);
        break;
      case 'run.set':
        runs = setEntry(runs, change.run, change.index, sessionId);
        break;
      case 'run.remove':
        runs = removeEntry(runs, change.id);
        break;
      case 'queue.set':
        queue = setEntry(queue, change.input, change.index, sessionId);
        break;
      case 'queue.remove':
        queue = removeEntry(queue, change.id);
        break;
      case 'tool.set':
        tools = setEntry(tools, change.tool, change.index, sessionId);
        break;
      case 'tool.remove':
        tools = removeEntry(tools, change.id);
        break;
      default:
        unsupportedChange(change);
    }
  }
  if (
    !branches.some(({ id }) => {
      return id === update.branchId;
    })
  ) {
    throw new Error('会话增量移除了当前分支。');
  }
  return {
    session: update.session,
    snapshotSeq: update.snapshotSeq,
    liveRevision: update.liveRevision,
    messages,
    branches,
    runs,
    queue,
    tools,
  };
};
