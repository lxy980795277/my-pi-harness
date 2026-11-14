import { Type, type Static } from 'typebox';
import { ThinkingLevelSchema } from '../application/models';

export type SessionArchiveManifest = Static<typeof SessionArchiveManifestSchema>;
export type SessionArchivePreview = Static<typeof SessionArchivePreviewSchema>;
export type SessionArchiveImportReceipt = Static<typeof SessionArchiveImportReceiptSchema>;
export type SessionArchiveImportBinding = Static<typeof SessionArchiveImportBindingSchema>;
export type SessionExecutionAccess = Static<typeof SessionExecutionAccessSchema>;

const id = Type.String({ minLength: 1, maxLength: 160 });
const hash = Type.String({ pattern: '^[a-f0-9]{64}$' });
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const dependencies = Type.Object(
  {
    providers: Type.Array(
      Type.Object(
        { providerId: id, modelIds: Type.Array(id, { maxItems: 256, uniqueItems: true }) },
        { additionalProperties: false },
      ),
      { maxItems: 256 },
    ),
    workspace: Type.Union([
      Type.Object(
        { workspaceId: id, name: Type.String({ maxLength: 200 }) },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    plugins: Type.Array(id, { maxItems: 512, uniqueItems: true }),
  },
  { additionalProperties: false },
);
const header = {
  formatVersion: Type.Literal(1),
  sessionId: id,
  title: Type.String({ maxLength: 500 }),
  snapshotSeq: count,
  createdAt: count,
  activeAtSnapshot: Type.Boolean(),
  dependencies,
};

/** Versioned resource closure, independent of compression and current execution authority. */
export const SessionArchiveManifestSchema = Type.Object(
  {
    ...header,
    entries: Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1, maxLength: 4096 }),
          kind: Type.Union([
            Type.Literal('journal'),
            Type.Literal('attachment'),
            Type.Literal('blob'),
            Type.Literal('skill'),
          ]),
          bytes: Type.Integer({ minimum: 0, maximum: 512 * 1024 * 1024 }),
          sha256: hash,
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 20000 },
    ),
  },
  { additionalProperties: false },
);
/** Preview omits the potentially large manifest entry list and bounds conflict details. */
export const SessionArchivePreviewSchema = Type.Object(
  {
    archiveSha256: hash,
    manifest: Type.Object(
      { ...header, entryCount: count, totalBytes: count },
      { additionalProperties: false },
    ),
    canImport: Type.Boolean(),
    conflictCount: count,
    conflicts: Type.Array(
      Type.Object({ kind: Type.String({ maxLength: 80 }), id }, { additionalProperties: false }),
      { maxItems: 100 },
    ),
    warnings: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 }),
  },
  { additionalProperties: false },
);
/** A durable import receipt binds an operation ID to the exact uploaded archive digest. */
export const SessionArchiveImportReceiptSchema = Type.Object(
  {
    operationId: id,
    archiveSha256: hash,
    sessionId: id,
    status: Type.Union([
      Type.Literal('publishing'),
      Type.Literal('completed'),
      Type.Literal('failed'),
    ]),
    createdAt: count,
    updatedAt: count,
    error: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
  },
  { additionalProperties: false },
);
/** Binding chooses current local dependencies; historical approvals never migrate. */
export const SessionArchiveImportBindingSchema = Type.Object(
  {
    providerId: id,
    modelId: id,
    thinkingLevel: ThinkingLevelSchema,
    workspaceId: Type.Union([id, Type.Null()]),
  },
  { additionalProperties: false },
);
export const SessionExecutionAccessSchema = Type.Object(
  { importedThroughSeq: Type.Union([count, Type.Null()]), bound: Type.Boolean() },
  { additionalProperties: false },
);
