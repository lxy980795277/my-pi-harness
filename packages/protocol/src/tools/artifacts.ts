import { Type, type Static } from 'typebox';

export type Artifact = Static<typeof ArtifactSchema>;

const id = Type.String({ minLength: 1, maxLength: 160 });
/** A host-registered immutable file; source paths are workspace-relative and never download targets. */
export const ArtifactSchema = Type.Object(
  {
    id,
    sessionId: id,
    runId: id,
    taskId: Type.Union([id, Type.Null()]),
    toolCallId: id,
    workspaceId: id,
    sourcePath: Type.String({ minLength: 1, maxLength: 2048 }),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    mediaType: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: '^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$',
    }),
    bytes: Type.Integer({ minimum: 1, maximum: 33_554_432 }),
    sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    createdAt: Type.Integer({ minimum: 0 }),
    producerCommandId: Type.Optional(id),
  },
  { additionalProperties: false },
);

export const ArtifactPublishedSchema = Type.Object(
  { artifact: ArtifactSchema },
  { additionalProperties: false },
);
