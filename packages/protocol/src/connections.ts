import { Type, type Static } from 'typebox';
const object = { additionalProperties: false } as const;
const id = Type.String({ minLength: 1, maxLength: 160 });
const epoch = Type.Integer({ minimum: 1 });
/** Finite provider families; Google sub-apps share one explicitly scoped connection. */
export const ConnectionServiceIdSchema = Type.Enum([
  'github',
  'google',
  'vercel',
  'notion',
  'supabase',
]);
export type ConnectionServiceId = Static<typeof ConnectionServiceIdSchema>;
export const ConnectionAuthModeSchema = Type.Enum(['oauth', 'token']);
export type ConnectionAuthMode = Static<typeof ConnectionAuthModeSchema>;
export const ConnectionInputSchema = Type.Object(
  {
    serviceId: ConnectionServiceIdSchema,
    name: Type.String({ minLength: 1, maxLength: 100 }),
    authMode: ConnectionAuthModeSchema,
    clientId: Type.String({ maxLength: 1000 }),
    scopes: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      maxItems: 30,
      uniqueItems: true,
    }),
  },
  object,
);
export type ConnectionInput = Static<typeof ConnectionInputSchema>;
export const ConnectionUpdateSchema = Type.Object(
  { ...ConnectionInputSchema.properties, expectedRevision: epoch },
  object,
);
export type ConnectionUpdate = Static<typeof ConnectionUpdateSchema>;
export const ConnectionControlSchema = Type.Object(
  { expectedRevision: epoch, expectedAccessEpoch: epoch },
  object,
);
export type ConnectionControl = Static<typeof ConnectionControlSchema>;
/** Public state contains no credential reference, token, verifier or OAuth secret. */
export const ConnectionViewSchema = Type.Object(
  {
    ...ConnectionInputSchema.properties,
    id,
    revision: epoch,
    accessEpoch: epoch,
    connected: Type.Boolean(),
    clientSecretConfigured: Type.Boolean(),
    accountId: Type.Union([id, Type.Null()]),
    accountName: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
  },
  object,
);
export type ConnectionView = Static<typeof ConnectionViewSchema>;
export const ConnectionSecretInputSchema = Type.Object(
  { ...ConnectionControlSchema.properties, value: Type.String({ minLength: 1, maxLength: 65536 }) },
  object,
);
export type ConnectionSecretInput = Static<typeof ConnectionSecretInputSchema>;
export const ConnectionProviderViewSchema = Type.Object(
  {
    serviceId: ConnectionServiceIdSchema,
    name: Type.String(),
    defaultScopes: Type.Array(Type.String()),
    mcpEndpoints: Type.Array(Type.String()),
    apps: Type.Array(Type.String()),
  },
  object,
);
export type ConnectionProviderView = Static<typeof ConnectionProviderViewSchema>;
export const ConnectionOperationViewSchema = Type.Object(
  {
    id,
    connectionId: Type.Optional(id),
    accountId: Type.Optional(id),
    serviceId: ConnectionServiceIdSchema,
    app: Type.String(),
    name: Type.String(),
    readOnly: Type.Boolean(),
    description: Type.String(),
    parameters: Type.Record(Type.String(), Type.Unknown()),
  },
  object,
);
export type ConnectionOperationView = Static<typeof ConnectionOperationViewSchema>;
export const ConnectionGrantSchema = Type.Object(
  {
    id,
    runId: id,
    skillId: id,
    skillHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    pluginId: id,
    pluginEpoch: Type.Integer({ minimum: 0 }),
    connectionId: id,
    serviceId: ConnectionServiceIdSchema,
    accountId: id,
    ownerId: id,
    identityEpoch: epoch,
    revision: epoch,
    accessEpoch: epoch,
    operations: Type.Array(id, { minItems: 1, maxItems: 30, uniqueItems: true }),
    expiresAt: Type.Integer({ minimum: 0 }),
  },
  object,
);
export type ConnectionGrant = Static<typeof ConnectionGrantSchema>;
