import { Type, type Static } from 'typebox';

export type ConnectionServiceId = Static<typeof ConnectionServiceIdSchema>;
export type ConnectionAuthMode = Static<typeof ConnectionAuthModeSchema>;
export type ConnectionInput = Static<typeof ConnectionInputSchema>;
export type ConnectionUpdate = Static<typeof ConnectionUpdateSchema>;
export type ConnectionControl = Static<typeof ConnectionControlSchema>;
export type ConnectionView = Static<typeof ConnectionViewSchema>;
export type ConnectionSecretInput = Static<typeof ConnectionSecretInputSchema>;
export type ConnectionProviderView = Static<typeof ConnectionProviderViewSchema>;

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

export const ConnectionAuthModeSchema = Type.Enum(['oauth', 'token']);

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

export const ConnectionUpdateSchema = Type.Object(
  { ...ConnectionInputSchema.properties, expectedRevision: epoch },
  object,
);

export const ConnectionControlSchema = Type.Object(
  { expectedRevision: epoch, expectedAccessEpoch: epoch },
  object,
);

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

export const ConnectionSecretInputSchema = Type.Object(
  { ...ConnectionControlSchema.properties, value: Type.String({ minLength: 1, maxLength: 65536 }) },
  object,
);

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
