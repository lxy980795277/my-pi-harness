import { Type } from 'typebox';
import { StoredToolResultSchema, type HarnessEvent } from '@my-pi-harness/protocol';
import { StorageError } from '../shared/errors.js';
import { checked } from '../shared/validation.js';
import {
  PreparedPrivateSchema,
  PreparedEventSchema,
  ToolContextEventSchema,
} from './event-validation.js';
import { projectStoredEvent } from './stored-event.js';

/** Complete host records after disk references have been resolved. */
export interface JournalRecord {
  event: HarnessEvent;
  privateData: Record<string, unknown> | null;
}

type BranchBaselines = ReadonlyMap<string, readonly Record<string, unknown>[]>;

/** Each Run owns its branch baselines; finishing a child never clears its active relatives. */
export type JournalCodecState = ReadonlyMap<string, BranchBaselines>;

interface ContextOwner {
  runId: string;
  branchId: string;
}

interface TransformedRecords {
  records: JournalRecord[];
  state: JournalCodecState;
}

const object = Type.Record(Type.String(), Type.Unknown());
const contextStored = Type.Object(
  {
    version: Type.Literal(1),
    systemPrompt: Type.Union([Type.String(), Type.Literal(0)]),
    messages: Type.Array(Type.Union([object, Type.Integer({ minimum: 0 })])),
  },
  { additionalProperties: false },
);
const contextBranch = Type.Pick(PreparedEventSchema, ['branchId'], { additionalProperties: true });
const toolContext = Type.Pick(ToolContextEventSchema, ['toolCallId'], {
  additionalProperties: true,
});
const terminalStatuses = new Set([
  'completed',
  'failed',
  'denied',
  'cancelled',
  'interrupted',
  'unknown',
]);

function invalid(message: string): never {
  throw new StorageError('INVALID_RECORD', message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function contextOwner(event: HarnessEvent): ContextOwner {
  const { branchId } = checked(contextBranch, event.data);
  if (event.runId === null || event.runId.length === 0) invalid('Journal request requires a Run');
  return { runId: event.runId, branchId };
}

function releaseRun(state: Map<string, BranchBaselines>, event: HarnessEvent): void {
  if (event.type !== 'run.finished') return;
  if (event.runId === null) invalid('Journal terminal record requires a Run');
  state.delete(event.runId);
}

function saveBaseline(
  state: Map<string, BranchBaselines>,
  owner: ContextOwner,
  messages: readonly Record<string, unknown>[],
): void {
  const branches = new Map(state.get(owner.runId));
  branches.set(owner.branchId, structuredClone(messages));
  state.set(owner.runId, branches);
}

function systemContent(messages: readonly Record<string, unknown>[]): string | undefined {
  const message = messages[0]?.['message'];
  return isObject(message) && message['role'] === 'system' && typeof message['content'] === 'string'
    ? message['content']
    : undefined;
}

function toolResultText(records: readonly JournalRecord[]): ReadonlyMap<string, string> {
  const results = new Map<string, string>();
  for (const record of records) {
    if (record.event.type !== 'tool.context') continue;
    const { toolCallId } = checked(toolContext, record.event.data);
    if (results.has(toolCallId)) invalid('Journal tool context is duplicated');
    const result = checked(StoredToolResultSchema, record.privateData);
    results.set(
      toolCallId,
      result.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n'),
    );
  }
  return results;
}

function transformToolResults(records: readonly JournalRecord[], decode: boolean): void {
  const results = toolResultText(records);
  for (const record of records) {
    if (record.event.type !== 'tool.updated' && record.event.type !== 'tool.requested') continue;
    const tool = record.event.data['tool'];
    if (!isObject(tool)) invalid('Journal tool event requires its tool');
    const result = tool['result'];
    const terminal = typeof tool['status'] === 'string' && terminalStatuses.has(tool['status']);
    const text = typeof tool['id'] === 'string' ? results.get(tool['id']) : undefined;
    if (typeof result === 'string' || result === null) {
      if (!decode && terminal && result === text) tool['result'] = { from: 'tool.context' };
      continue;
    }
    if (
      !decode ||
      !terminal ||
      !isObject(result) ||
      Object.keys(result).length !== 1 ||
      result['from'] !== 'tool.context' ||
      text === undefined
    )
      invalid('Journal tool result reference is invalid');
    tool['result'] = text;
  }
}

/**
 * Encode repeated requests against the preceding snapshot in the same Run and branch.
 * @param input Complete records in one atomic journal batch.
 * @param previous Request baselines from preceding committed batches of this session.
 * @returns Detached disk records and baselines to publish only after the batch is durable.
 */
export function encodeJournalRecords(
  input: readonly JournalRecord[],
  previous: JournalCodecState,
): TransformedRecords {
  const records = structuredClone([...input]);
  const state = new Map(previous);
  for (const record of records) {
    releaseRun(state, record.event);
    if (record.event.type !== 'context.prepared') continue;
    const owner = contextOwner(record.event);
    const payload = record.privateData ?? invalid('Journal request requires private data');
    const context = checked(PreparedPrivateSchema, payload);
    const baseline = state.get(owner.runId)?.get(owner.branchId);
    const references = new Map(baseline?.map((message, index) => [JSON.stringify(message), index]));
    const messages = context.messages.map(
      (message) => references.get(JSON.stringify(message)) ?? message,
    );
    saveBaseline(state, owner, context.messages);
    if (context.systemPrompt === systemContent(context.messages)) payload['systemPrompt'] = 0;
    payload['messages'] = messages;
  }
  transformToolResults(records, false);
  return { records, state };
}

/**
 * Restore disk references while preserving property order and isolating the next request baseline.
 * @param input Parsed records from one checksum-verified journal batch.
 * @param previous Request baselines from preceding validated batches of this session.
 * @returns Complete records and the next baselines; invalid references fail the whole batch.
 */
export function decodeJournalRecords(
  input: readonly JournalRecord[],
  previous: JournalCodecState,
): TransformedRecords {
  const records = structuredClone([...input]);
  const state = new Map(previous);
  for (const record of records) {
    releaseRun(state, record.event);
    if (record.event.type !== 'context.prepared') continue;
    const owner = contextOwner(record.event);
    const context = checked(contextStored, record.privateData);
    const baseline = state.get(owner.runId)?.get(owner.branchId);
    const messages = context.messages.map((message) => {
      if (typeof message !== 'number') return message;
      const referenced = baseline?.[message];
      if (referenced === undefined) invalid('Journal request message reference is invalid');
      return structuredClone(referenced);
    });
    if (context.systemPrompt === 0) {
      const prompt = systemContent(messages);
      if (prompt === undefined) invalid('Journal system prompt reference is invalid');
      context['systemPrompt'] = prompt;
    }
    context['messages'] = messages;
    saveBaseline(state, owner, messages);
  }
  transformToolResults(records, true);
  for (const record of records) record.event = projectStoredEvent(record.event);
  return { records, state };
}
