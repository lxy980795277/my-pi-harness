import { Type, type Static } from 'typebox';

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
      Type.Object({ id: Type.String(), provider: Type.String(), name: Type.String() }, object),
    ),
  },
  object,
);
export type PluginManifest = Static<typeof PluginManifestSchema>;
export const PluginComponentSchema = Type.Object(
  {
    id: Type.String(),
    kind: Type.Enum(['skill', 'app']),
    enabled: Type.Boolean(),
    referenceId: Type.String(),
  },
  object,
);
export type PluginComponent = Static<typeof PluginComponentSchema>;
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
export type PluginView = Static<typeof PluginViewSchema>;
export const PluginControlInputSchema = Type.Object(
  { expectedRevision: Type.Integer({ minimum: 1 }), enabled: Type.Boolean() },
  object,
);
export type PluginControlInput = Static<typeof PluginControlInputSchema>;
export const PluginRemoveInputSchema = Type.Object(
  { expectedRevision: Type.Integer({ minimum: 1 }) },
  object,
);
export type PluginRemoveInput = Static<typeof PluginRemoveInputSchema>;
