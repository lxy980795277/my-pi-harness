import type {
  MessageView,
  SessionChange,
  SessionSnapshot,
  SessionStreamUpdate,
} from '@my-pi-harness/protocol';

interface Identified {
  id: string;
}

interface CollectionChange<T> {
  removed: string[];
  updated: { value: T; index: number; previous: T | undefined }[];
}

const MAX_PATCH_BYTES = 512 * 1024;
const MAX_PATCH_CHANGES = 256;

const collectionChanges = <T extends Identified>(
  previous: T[],
  current: T[],
  equal: (left: T, right: T) => boolean,
): CollectionChange<T> | undefined => {
  const before = new Map(previous.map((value) => [value.id, value]));
  const after = new Set(current.map(({ id }) => id));
  const retainedBefore = previous.filter(({ id }) => after.has(id)).map(({ id }) => id);
  const retainedAfter = current.filter(({ id }) => before.has(id)).map(({ id }) => id);
  if (retainedBefore.some((id, index) => retainedAfter[index] !== id)) return undefined;
  const updated: CollectionChange<T>['updated'] = [];
  for (const [index, value] of current.entries()) {
    const old = before.get(value.id);
    if (!old || !equal(old, value)) updated.push({ value, index, previous: old });
  }
  return { removed: previous.filter(({ id }) => !after.has(id)).map(({ id }) => id), updated };
};

const equalJson = (left: unknown, right: unknown): boolean => {
  return JSON.stringify(left) === JSON.stringify(right);
};

const messageMetadata = (message: MessageView): Omit<MessageView, 'text' | 'thinking'> => {
  const { text: _text, thinking: _thinking, ...metadata } = message;
  return metadata;
};

const equalMessage = (left: MessageView, right: MessageView): boolean => {
  return (
    left.text === right.text &&
    left.thinking === right.thinking &&
    equalJson(messageMetadata(left), messageMetadata(right))
  );
};

const messageChange = (
  message: MessageView,
  index: number,
  previous: MessageView | undefined,
): SessionChange => {
  if (
    previous &&
    previous.status === 'streaming' &&
    equalJson(messageMetadata(previous), messageMetadata(message)) &&
    message.text.startsWith(previous.text) &&
    message.thinking.startsWith(previous.thinking)
  ) {
    return {
      type: 'message.append',
      id: message.id,
      textDelta: message.text.slice(previous.text.length),
      thinkingDelta: message.thinking.slice(previous.thinking.length),
    };
  }
  // New, rewritten and terminal messages carry their exact committed body and metadata.
  return { type: 'message.set', index, message };
};

/** Diffs committed projections; oversized batches and reordered/changed branches use a snapshot. */
export const createSessionUpdate = (
  previous: SessionSnapshot | undefined,
  current: SessionSnapshot,
): SessionStreamUpdate | undefined => {
  if (!previous) return { kind: 'snapshot', snapshot: current };
  if (previous.session.id !== current.session.id) throw new Error('Session stream owner changed');
  if (current.snapshotSeq <= previous.snapshotSeq) return undefined;
  if (previous.session.activeBranchId !== current.session.activeBranchId)
    return { kind: 'snapshot', snapshot: current };

  const messages = collectionChanges(previous.messages, current.messages, equalMessage);
  const branches = collectionChanges(previous.branches, current.branches, equalJson);
  const runs = collectionChanges(previous.runs, current.runs, equalJson);
  const queue = collectionChanges(previous.queue, current.queue, equalJson);
  const tools = collectionChanges(previous.tools, current.tools, equalJson);
  if (!messages || !branches || !runs || !queue || !tools)
    return { kind: 'snapshot', snapshot: current };

  const changes: SessionChange[] = [];
  for (const id of messages.removed) changes.push({ type: 'message.remove', id });
  for (const { value, index, previous: old } of messages.updated)
    changes.push(messageChange(value, index, old));
  for (const id of branches.removed) changes.push({ type: 'branch.remove', id });
  for (const { value, index } of branches.updated)
    changes.push({ type: 'branch.set', index, branch: value });
  for (const id of runs.removed) changes.push({ type: 'run.remove', id });
  for (const { value, index } of runs.updated) changes.push({ type: 'run.set', index, run: value });
  for (const id of queue.removed) changes.push({ type: 'queue.remove', id });
  for (const { value, index } of queue.updated)
    changes.push({ type: 'queue.set', index, input: value });
  for (const id of tools.removed) changes.push({ type: 'tool.remove', id });
  for (const { value, index } of tools.updated)
    changes.push({ type: 'tool.set', index, tool: value });

  if (changes.length > MAX_PATCH_CHANGES) return { kind: 'snapshot', snapshot: current };
  const patch: SessionStreamUpdate = {
    kind: 'patch',
    sessionId: current.session.id,
    branchId: current.session.activeBranchId,
    baseSeq: previous.snapshotSeq,
    snapshotSeq: current.snapshotSeq,
    session: current.session,
    changes,
  };
  if (Buffer.byteLength(JSON.stringify(patch)) > MAX_PATCH_BYTES)
    return { kind: 'snapshot', snapshot: current };
  return patch;
};
