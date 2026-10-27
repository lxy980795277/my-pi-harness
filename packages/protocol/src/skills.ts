import { Type, type Static } from 'typebox';

const object = { additionalProperties: false } as const;
const id = Type.String({ minLength: 1, maxLength: 160 });
const hash = Type.String({ pattern: '^[a-f0-9]{64}$' });
/** Scope records who owns the source; it does not grant filesystem access. */
export const SkillScopeSchema = Type.Enum(['project', 'user', 'plugin', 'system']);
export type SkillScope = Static<typeof SkillScopeSchema>;
/** A selection binds an immutable version, independently of a human-readable name. */
export const SkillSelectionSchema = Type.Object({ id, contentHash: hash }, object);
export type SkillSelection = Static<typeof SkillSelectionSchema>;
export const SkillSelectionsSchema = Type.Array(SkillSelectionSchema, { maxItems: 16 });
/** Catalog metadata excludes the instruction body and resource contents. */
export const SkillViewSchema = Type.Object(
  {
    id,
    name: Type.String(),
    description: Type.String(),
    scope: SkillScopeSchema,
    pluginId: Type.Union([id, Type.Null()]),
    workspaceId: Type.Union([id, Type.Null()]),
    contentHash: hash,
    enabled: Type.Boolean(),
    shadowed: Type.Boolean(),
    managed: Type.Boolean(),
    resourceCount: Type.Integer({ minimum: 0 }),
    source: Type.String(),
  },
  object,
);
export type SkillView = Static<typeof SkillViewSchema>;
export const SkillResourceSchema = Type.Object(
  { path: Type.String(), hash, size: Type.Integer({ minimum: 0 }), mediaType: Type.String() },
  object,
);
export type SkillResource = Static<typeof SkillResourceSchema>;
/** Loaded instructions and resource identities can be stored in the private Run log. */
export const FrozenSkillSchema = Type.Object(
  {
    selection: SkillSelectionSchema,
    authorization: Type.Object(
      {
        skillEpoch: Type.Integer({ minimum: 0 }),
        pluginId: Type.Union([id, Type.Null()]),
        pluginEpoch: Type.Integer({ minimum: 0 }),
        pluginGeneration: Type.Union([Type.String(), Type.Null()]),
      },
      object,
    ),
    name: Type.String(),
    description: Type.String(),
    scope: SkillScopeSchema,
    source: Type.String(),
    content: Type.String({ maxLength: 131072 }),
    gatewayUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
    resources: Type.Array(SkillResourceSchema, { maxItems: 256 }),
    allowedTools: Type.Array(Type.String(), { maxItems: 128 }),
  },
  object,
);
export type FrozenSkill = Static<typeof FrozenSkillSchema>;
export const SkillDetailSchema = Type.Object(
  {
    ...SkillViewSchema.properties,
    content: Type.String(),
    resources: Type.Array(SkillResourceSchema),
    allowedTools: Type.Array(Type.String()),
  },
  object,
);
export type SkillDetail = Static<typeof SkillDetailSchema>;
export const SkillCreateInputSchema = Type.Object(
  {
    scope: Type.Enum(['user', 'project']),
    workspaceId: Type.Union([id, Type.Null()]),
    name: Type.String({ pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 64 }),
    description: Type.String({ minLength: 1, maxLength: 1024 }),
    content: Type.String({ minLength: 1, maxLength: 120000 }),
  },
  object,
);
export type SkillCreateInput = Static<typeof SkillCreateInputSchema>;
export const SkillInstallInputSchema = Type.Object(
  {
    scope: Type.Enum(['user', 'project']),
    workspaceId: Type.Union([id, Type.Null()]),
    owner: Type.String({ pattern: '^[A-Za-z0-9-]+$', maxLength: 100 }),
    repository: Type.String({ pattern: '^[A-Za-z0-9_.-]+$', maxLength: 100 }),
    ref: Type.String({ minLength: 1, maxLength: 200 }),
    path: Type.String({ maxLength: 512 }),
  },
  object,
);
export type SkillInstallInput = Static<typeof SkillInstallInputSchema>;
export const SkillControlInputSchema = Type.Object(
  { contentHash: hash, enabled: Type.Boolean() },
  object,
);
export type SkillControlInput = Static<typeof SkillControlInputSchema>;

/** Resource reads expose only bytes belonging to the selected immutable Skill version. */
export const SkillResourceReadSchema = Type.Object(
  { contentHash: hash, path: Type.String({ minLength: 1, maxLength: 512 }) },
  object,
);
export type SkillResourceRead = Static<typeof SkillResourceReadSchema>;
export const SkillResourceContentSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal('text'),
      text: Type.String({ maxLength: 2097152 }),
      path: Type.String(),
      hash,
    },
    object,
  ),
  Type.Object(
    {
      type: Type.Literal('image'),
      data: Type.String({ maxLength: 3000000 }),
      mimeType: Type.String(),
      path: Type.String(),
      hash,
    },
    object,
  ),
]);
export type SkillResourceContent = Static<typeof SkillResourceContentSchema>;
