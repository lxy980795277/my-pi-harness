import { Type, type Static } from 'typebox';
import { SkillConnectionAccountSchema } from '../extensions/skill-connections';
import { PluginComponentSchema } from '../extensions/plugins';

export type PluginInstallation = Static<typeof PluginInstallationSchema>;
export type PluginOAuthCredential = Static<typeof PluginOAuthCredentialSchema>;

const object = { additionalProperties: false } as const;
const id = Type.String({ minLength: 1, maxLength: 160 });

/** Host-owned installation facts; public plugin views exclude directory and installation identity. */
export const PluginInstallationSchema = Type.Object(
  {
    generation: Type.String({ minLength: 1, maxLength: 160 }),
    id,
    revision: Type.Integer({ minimum: 1 }),
    enabled: Type.Boolean(),
    directory: Type.String(),
    components: Type.Array(PluginComponentSchema),
  },
  object,
);

/** Private account credentials never enter public configuration or conversation events. */
export const PluginOAuthCredentialSchema = Type.Object(
  {
    accessToken: Type.String({ minLength: 1, maxLength: 65536 }),
    refreshToken: Type.Optional(Type.String({ minLength: 1, maxLength: 65536 })),
    account: Type.Union([SkillConnectionAccountSchema, Type.Null()]),
    apiUrl: Type.String({ minLength: 1, maxLength: 4096 }),
    connectedAt: Type.Integer({ minimum: 0 }),
    expiresAt: Type.Optional(Type.Integer({ minimum: 0 })),
    ownerId: id,
    identityEpoch: Type.Integer({ minimum: 1 }),
    pluginGeneration: id,
  },
  object,
);
