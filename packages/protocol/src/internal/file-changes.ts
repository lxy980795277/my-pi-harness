import { Type, type Static } from 'typebox';
import {
  FileChangeImageSchema,
  FileChangeBatchItemSchema,
  FileChangeBatchReceiptSchema,
} from '../sessions/file-changes';

export type FileOperationPrepare = Static<typeof FileOperationPrepareSchema>;
export type FileOperationOutcome = Static<typeof FileOperationOutcomeSchema>;
export type FileOperationObservation = Static<typeof FileOperationObservationSchema>;
export type FileOperationRecord = Static<typeof FileOperationRecordSchema>;
export type FileChangeHead = Static<typeof FileChangeHeadSchema>;
export type FileChangeRecord = Static<typeof FileChangeRecordSchema>;
export type FileChangeBatchAccept = Static<typeof FileChangeBatchAcceptSchema>;

const id = Type.String({ minLength: 1, maxLength: 160 });
const nullableId = Type.Union([id, Type.Null()]);
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const digest = Type.String({ pattern: '^[a-f0-9]{64}$' });
const identity = Type.Object(
  {
    device: Type.String({ pattern: '^[0-9]{1,40}$' }),
    inode: Type.String({ pattern: '^[0-9]{1,40}$' }),
  },
  { additionalProperties: false },
);

/** Filesystem identity and idempotency guards are host-only durable metadata. */
export const FileOperationHostSchema = Type.Object(
  {
    requestHash: digest,
    targetKey: digest,
    rootIdentity: identity,
    parentIdentity: identity,
    expectedRevision: count,
    local: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const FileOperationIntentSchema = Type.Object(
  {
    operationId: id,
    action: Type.Union([Type.Literal('write'), Type.Literal('undo'), Type.Literal('redo')]),
    targetChangeId: nullableId,
    workspaceId: id,
    path: Type.String({ minLength: 1, maxLength: 2000 }),
    branchId: id,
    before: FileChangeImageSchema,
    after: FileChangeImageSchema,
    source: Type.Union([
      Type.Object({ kind: Type.Literal('tool'), toolCallId: id }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal('user') }, { additionalProperties: false }),
    ]),
  },
  { additionalProperties: false },
);
export const FileOperationPrepareSchema = Type.Object(
  { ...FileOperationIntentSchema.properties, ...FileOperationHostSchema.properties },
  { additionalProperties: false },
);
export const FileOperationObservationSchema = Type.Object(
  {
    match: Type.Union([
      Type.Literal('before'),
      Type.Literal('after'),
      Type.Literal('both'),
      Type.Literal('other'),
      Type.Literal('unavailable'),
    ]),
    at: count,
  },
  { additionalProperties: false },
);
export const FileOperationOutcomeSchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal('applied'),
      Type.Literal('not_applied'),
      Type.Literal('conflict'),
      Type.Literal('unknown'),
    ]),
    error: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export const FileOperationRecordSchema = Type.Object(
  {
    sessionId: id,
    runId: nullableId,
    seq: count,
    createdAt: count,
    finishedAt: Type.Union([count, Type.Null()]),
    intent: FileOperationPrepareSchema,
    status: Type.Union([
      Type.Literal('prepared'),
      Type.Literal('applied'),
      Type.Literal('not_applied'),
      Type.Literal('conflict'),
      Type.Literal('unknown'),
    ]),
    outcome: Type.Union([FileOperationOutcomeSchema, Type.Null()]),
    observation: Type.Union([FileOperationObservationSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export const FileChangeHeadSchema = Type.Object(
  {
    targetKey: digest,
    revision: count,
    headChangeId: nullableId,
    redoTopChangeId: nullableId,
    redoEpoch: nullableId,
    pendingOperationId: nullableId,
    uncertainOperationId: nullableId,
  },
  { additionalProperties: false },
);
export const FileChangeRecordSchema = Type.Object(
  {
    operation: FileOperationRecordSchema,
    applied: Type.Boolean(),
    previousChangeId: nullableId,
    redoNextChangeId: nullableId,
    redoEpoch: nullableId,
    local: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const FileChangeBatchAcceptSchema = Type.Object(
  {
    operationId: id,
    requestHash: digest,
    action: FileChangeBatchReceiptSchema.properties.action,
    items: Type.Array(Type.Pick(FileChangeBatchItemSchema, ['changeId', 'path']), {
      minItems: 1,
      maxItems: 50,
    }),
  },
  { additionalProperties: false },
);
