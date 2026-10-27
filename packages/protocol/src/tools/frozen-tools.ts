import { Type, type Static } from 'typebox';
import { McpScopeSchema, McpToolSelectionSchema } from '../extensions/mcp.js';

export type ExternalToolAuthorization = Static<typeof ExternalToolAuthorizationSchema>;
export type FrozenMcpToolData = Static<typeof FrozenMcpToolSchema>;

/** Non-secret private journal data; this schema never makes host authorization a public DTO. */
export const ExternalToolAuthorizationSchema = Type.Object(
  {
    ownerId: Type.String(),
    identityEpoch: Type.Integer({ minimum: 1 }),
    accessEpoch: Type.Integer({ minimum: 1 }),
    credentialEpoch: Type.Integer({ minimum: 1 }),
    grantId: Type.String(),
    workspaceId: Type.String(),
    workspaceRoot: Type.String(),
    scope: McpScopeSchema,
    startupFingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    toolControlRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    readOnlyGrantId: Type.Optional(Type.String({ minLength: 1 })),
    connectionId: Type.Optional(Type.String({ minLength: 1 })),
    connectionAccessEpoch: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

/** Exact executable binding frozen with an input and each subsequent visibility revision. */
export const FrozenMcpToolSchema = Type.Object(
  {
    selection: McpToolSelectionSchema,
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
    definition: Type.Object(
      {
        name: Type.String(),
        description: Type.String(),
        parameters: Type.Record(Type.String(), Type.Unknown()),
      },
      { additionalProperties: false },
    ),
    authorization: ExternalToolAuthorizationSchema,
  },
  { additionalProperties: false },
);

export const FrozenMcpToolsSchema = Type.Array(FrozenMcpToolSchema, { maxItems: 512 });
