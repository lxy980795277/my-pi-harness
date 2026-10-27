import { Type, type Static } from 'typebox';

export type PluginManifest = Static<typeof PluginManifestSchema>;
export type PluginComponent = Static<typeof PluginComponentSchema>;
export type PluginView = Static<typeof PluginViewSchema>;
export type PluginSkillPreview = Static<typeof PluginSkillPreviewSchema>;
export type PluginDetail = Static<typeof PluginDetailSchema>;
export type PluginControlInput = Static<typeof PluginControlInputSchema>;
export type PluginRemoveInput = Static<typeof PluginRemoveInputSchema>;

const object = { additionalProperties: false } as const;

/** Built-in manifests are declarative resources; they cannot execute package lifecycle code. */
export const PluginManifestSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-z][a-z0-9-]*$' }),
    name: Type.String(),
    description: Type.String(),
    category: Type.Enum(['services', 'office']),
    version: Type.String(),
    skills: Type.Array(Type.String()),
    apps: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          provider: Type.String(),
          name: Type.String(),
          description: Type.Optional(Type.String({ maxLength: 1024 })),
          credentialSource: Type.Optional(Type.Enum(['plugin-oauth', 'mcp-oauth', 'none'])),
        },
        object,
      ),
    ),
  },
  object,
);

export const PluginComponentSchema = Type.Object(
  {
    id: Type.String(),
    kind: Type.Enum(['skill', 'app']),
    enabled: Type.Boolean(),
    referenceId: Type.String(),
  },
  object,
);

export const PluginViewSchema = Type.Object(
  {
    manifest: PluginManifestSchema,
    installed: Type.Boolean(),
    enabled: Type.Boolean(),
    revision: Type.Integer({ minimum: 0 }),
    components: Type.Array(PluginComponentSchema),
  },
  object,
);

/** Read-only bundled instructions; preview grants neither installation nor Run authority. */
export const PluginSkillPreviewSchema = Type.Object(
  {
    name: Type.String({ pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 64 }),
    description: Type.String({ minLength: 1, maxLength: 1024 }),
    content: Type.String({ minLength: 1, maxLength: 131072 }),
  },
  object,
);

/** Current installation preferences and safe previews of this built-in manifest's Skills. */
export const PluginDetailSchema = Type.Object(
  {
    plugin: PluginViewSchema,
    skills: Type.Array(PluginSkillPreviewSchema, { maxItems: 32 }),
  },
  object,
);

export const PluginControlInputSchema = Type.Object(
  { expectedRevision: Type.Integer({ minimum: 1 }), enabled: Type.Boolean() },
  object,
);

export const PluginRemoveInputSchema = Type.Object(
  { expectedRevision: Type.Integer({ minimum: 1 }) },
  object,
);
