import { Type, type Static } from 'typebox';

const id = Type.String({ minLength: 1, maxLength: 160 });
const revision = Type.Integer({ minimum: 1 });
const environmentName = Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]*$', maxLength: 128 });
const object = { additionalProperties: false } as const;

/** Startup grants are independent for supervised and unrestricted child processes. */
export const McpScopeSchema = Type.Enum(['sandboxed', 'full-access']);
export type McpScope = Static<typeof McpScopeSchema>;

/** A secret slot contains a destination name, never an opaque credential reference. */
export const McpSecretSlotSchema = Type.Object(
  { slotId: id, environmentName, configured: Type.Boolean() },
  object,
);
export type McpSecretSlot = Static<typeof McpSecretSlotSchema>;

/** Safe server settings contain only explicitly public environment values. */
export const McpServerInputSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    workspaceId: id,
    command: Type.String({ minLength: 1, maxLength: 4096 }),
    args: Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 64 }),
    publicEnvironment: Type.Record(environmentName, Type.String({ maxLength: 8192 }), {
      additionalProperties: false,
      maxProperties: 64,
    }),
    secretSlots: Type.Array(Type.Object({ slotId: id, environmentName }, object), { maxItems: 32 }),
  },
  object,
);
export type McpServerInput = Static<typeof McpServerInputSchema>;

export const McpServerUpdateSchema = Type.Object(
  { ...McpServerInputSchema.properties, expectedRevision: revision },
  object,
);
export type McpServerUpdate = Static<typeof McpServerUpdateSchema>;

/** Server controls use their own epoch so toggles cannot revive accepted bindings. */
export const McpControlInputSchema = Type.Object(
  { expectedRevision: revision, expectedAccessEpoch: revision },
  object,
);
export type McpControlInput = Static<typeof McpControlInputSchema>;
export const McpScopeInputSchema = Type.Object(
  { expectedRevision: revision, expectedAccessEpoch: revision, scope: McpScopeSchema },
  object,
);
export type McpScopeInput = Static<typeof McpScopeInputSchema>;

/** Client-readable status never exposes command output, secrets or credential references. */
export const McpServerViewSchema = Type.Object(
  {
    id,
    name: Type.String(),
    transport: Type.Literal('stdio'),
    revision,
    workspaceId: id,
    command: Type.String(),
    args: Type.Array(Type.String()),
    publicEnvironment: Type.Record(Type.String(), Type.String()),
    secretSlots: Type.Array(McpSecretSlotSchema),
    enabled: Type.Boolean(),
    accessEpoch: revision,
    trustedScopes: Type.Array(McpScopeSchema),
    connectionState: Type.Enum(['disconnected', 'connected']),
    diagnostic: Type.Union([Type.String({ maxLength: 1000 }), Type.Null()]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
  },
  object,
);
export type McpServerView = Static<typeof McpServerViewSchema>;

/** Preview resolves the effective executable and registered root without spawning it. */
export const McpTrustPreviewSchema = Type.Object(
  {
    serverId: id,
    revision,
    accessEpoch: revision,
    scope: McpScopeSchema,
    command: Type.String(),
    args: Type.Array(Type.String()),
    workspaceRoot: Type.String(),
    environmentNames: Type.Array(Type.String()),
    networkPolicy: Type.Enum(['blocked', 'unrestricted']),
    startupFingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  },
  object,
);
export type McpTrustPreview = Static<typeof McpTrustPreviewSchema>;
export const McpTrustInputSchema = Type.Object(
  {
    ...McpScopeInputSchema.properties,
    startupFingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  },
  object,
);
export type McpTrustInput = Static<typeof McpTrustInputSchema>;

/** A remote tool can be unavailable when its schema cannot be represented safely. */
export const McpToolViewSchema = Type.Object(
  {
    serverId: id,
    serverRevision: revision,
    remoteToolName: Type.String({ minLength: 1, maxLength: 256 }),
    name: Type.String({ minLength: 1, maxLength: 128 }),
    description: Type.String({ maxLength: 16000 }),
    definitionFingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    available: Type.Boolean(),
    enabled: Type.Optional(Type.Boolean()),
    readOnlyAuthorized: Type.Optional(Type.Boolean()),
    diagnostic: Type.Union([Type.String({ maxLength: 1000 }), Type.Null()]),
  },
  object,
);
export type McpToolView = Static<typeof McpToolViewSchema>;
export const McpToolCatalogSchema = Type.Object(
  {
    serverId: id,
    serverRevision: revision,
    scope: McpScopeSchema,
    discoveredAt: Type.Integer({ minimum: 0 }),
    tools: Type.Array(McpToolViewSchema, { maxItems: 512 }),
  },
  object,
);
export type McpToolCatalog = Static<typeof McpToolCatalogSchema>;

/** Frozen input selections refer to one discovered definition, independently of a display name. */
export const McpToolSelectionSchema = Type.Object(
  {
    serverId: id,
    serverRevision: revision,
    remoteToolName: Type.String({ minLength: 1, maxLength: 256 }),
    definitionFingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  },
  object,
);
export type McpToolSelection = Static<typeof McpToolSelectionSchema>;
export const McpToolSelectionsSchema = Type.Array(McpToolSelectionSchema, { maxItems: 16 });

/** Secrets are submitted only to this endpoint and are never included in response DTOs. */
export const McpSecretInputSchema = Type.Object(
  { expectedRevision: revision, value: Type.String({ minLength: 1, maxLength: 65536 }) },
  object,
);
export type McpSecretInput = Static<typeof McpSecretInputSchema>;
export const McpRevisionInputSchema = Type.Object({ expectedRevision: revision }, object);
export type McpRevisionInput = Static<typeof McpRevisionInputSchema>;

export const McpMetadataSchema = Type.Object(
  {
    resources: Type.Array(
      Type.Object(
        {
          uri: Type.String({ maxLength: 8192 }),
          name: Type.String({ maxLength: 1024 }),
          description: Type.Optional(Type.String({ maxLength: 16000 })),
          mimeType: Type.Optional(Type.String({ maxLength: 256 })),
        },
        object,
      ),
      { maxItems: 512 },
    ),
    prompts: Type.Array(
      Type.Object(
        {
          name: Type.String({ maxLength: 1024 }),
          description: Type.Optional(Type.String({ maxLength: 16000 })),
          arguments: Type.Array(
            Type.Object(
              {
                name: Type.String({ maxLength: 256 }),
                description: Type.Optional(Type.String({ maxLength: 16000 })),
                required: Type.Boolean(),
              },
              object,
            ),
            { maxItems: 64 },
          ),
        },
        object,
      ),
      { maxItems: 512 },
    ),
  },
  object,
);
export type McpMetadata = Static<typeof McpMetadataSchema>;

/** Tool control revisions invalidate bindings even when a tool is re-enabled. */
export const McpToolControlSchema = Type.Object(
  {
    serverId: id,
    remoteToolName: Type.String({ minLength: 1, maxLength: 256 }),
    revision,
    enabled: Type.Boolean(),
  },
  object,
);
export type McpToolControl = Static<typeof McpToolControlSchema>;
export const McpToolControlInputSchema = Type.Object(
  {
    expectedRevision: revision,
    expectedAccessEpoch: revision,
    remoteToolName: Type.String({ minLength: 1, maxLength: 256 }),
    enabled: Type.Boolean(),
  },
  object,
);
export type McpToolControlInput = Static<typeof McpToolControlInputSchema>;
export const McpReadOnlyGrantInputSchema = Type.Object(
  {
    ...McpToolSelectionSchema.properties,
    expectedAccessEpoch: revision,
    arguments: Type.Record(Type.String(), Type.Unknown(), { maxProperties: 128 }),
  },
  object,
);
export type McpReadOnlyGrantInput = Static<typeof McpReadOnlyGrantInputSchema>;

export const RemoteMcpTransportSchema = Type.Enum(['streamable-http', 'sse']);
export type RemoteMcpTransport = Static<typeof RemoteMcpTransportSchema>;
const headerName = Type.String({ pattern: '^[A-Za-z][A-Za-z0-9-]{0,127}$' });
/** Draft headers are transient test credentials and never become persisted configuration. */
export const RemoteMcpDraftTestInputSchema = Type.Object(
  {
    transport: RemoteMcpTransportSchema,
    endpoint: Type.String({ minLength: 1, maxLength: 8192 }),
    headers: Type.Record(headerName, Type.String({ maxLength: 8192 }), { maxProperties: 32 }),
  },
  object,
);
export type RemoteMcpDraftTestInput = Static<typeof RemoteMcpDraftTestInputSchema>;
export const RemoteMcpDraftTestResultSchema = Type.Object(
  {
    connected: Type.Literal(true),
    toolCount: Type.Integer({ minimum: 0, maximum: 512 }),
    resourceCount: Type.Integer({ minimum: 0, maximum: 512 }),
    promptCount: Type.Integer({ minimum: 0, maximum: 512 }),
    elapsedMs: Type.Integer({ minimum: 0 }),
  },
  object,
);
export type RemoteMcpDraftTestResult = Static<typeof RemoteMcpDraftTestResultSchema>;
export const RemoteMcpInputSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    transport: RemoteMcpTransportSchema,
    endpoint: Type.String({ minLength: 1, maxLength: 8192 }),
    publicHeaders: Type.Record(headerName, Type.String({ maxLength: 8192 }), { maxProperties: 32 }),
    secretHeaders: Type.Array(Type.Object({ slotId: id, headerName }, object), { maxItems: 16 }),
    oauth: Type.Boolean(),
    connectionId: Type.Optional(id),
    oauthClient: Type.Optional(
      Type.Object(
        {
          clientId: Type.String({ minLength: 1, maxLength: 4096 }),
          issuer: Type.String({ minLength: 1, maxLength: 8192 }),
          scopes: Type.Array(Type.String({ maxLength: 256 }), { maxItems: 64 }),
          clientSecret: Type.Boolean(),
          accessTypeOffline: Type.Boolean(),
        },
        object,
      ),
    ),
  },
  object,
);
export type RemoteMcpInput = Static<typeof RemoteMcpInputSchema>;
export const RemoteMcpUpdateSchema = Type.Object(
  { ...RemoteMcpInputSchema.properties, expectedRevision: revision },
  object,
);
export type RemoteMcpUpdate = Static<typeof RemoteMcpUpdateSchema>;
export const McpCatalogStatusSchema = Type.Enum(['idle', 'loading', 'ready', 'error']);
export const McpCatalogErrorSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 100 }),
    message: Type.String({ maxLength: 1000 }),
  },
  object,
);
/** Safe discovery facts frozen for model context; these records never authorize a tool call. */
export const ToolDiscoveryDiagnosticSchema = Type.Object(
  {
    serverId: id,
    name: Type.String({ minLength: 1, maxLength: 512 }),
    status: McpCatalogStatusSchema,
    toolCount: Type.Integer({ minimum: 0, maximum: 512 }),
    error: Type.Optional(McpCatalogErrorSchema),
  },
  object,
);
export type ToolDiscoveryDiagnostic = Static<typeof ToolDiscoveryDiagnosticSchema>;
export const RemoteMcpViewSchema = Type.Object(
  {
    ...RemoteMcpInputSchema.properties,
    secretHeaders: Type.Array(
      Type.Object({ slotId: id, headerName, configured: Type.Boolean() }, object),
      { maxItems: 16 },
    ),
    id,
    revision,
    accessEpoch: revision,
    enabled: Type.Boolean(),
    trusted: Type.Boolean(),
    oauthConnected: Type.Boolean(),
    catalogStatus: McpCatalogStatusSchema,
    catalogError: Type.Optional(McpCatalogErrorSchema),
    oauthClientSecretConfigured: Type.Optional(Type.Boolean()),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
  },
  object,
);
export type RemoteMcpView = Static<typeof RemoteMcpViewSchema>;
export const RemoteMcpTrustPreviewSchema = Type.Object(
  {
    serverId: id,
    revision,
    accessEpoch: revision,
    endpoint: Type.String(),
    transport: RemoteMcpTransportSchema,
    headerNames: Type.Array(Type.String()),
    fingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  },
  object,
);
export type RemoteMcpTrustPreview = Static<typeof RemoteMcpTrustPreviewSchema>;
export const RemoteMcpTrustInputSchema = Type.Object(
  { ...McpControlInputSchema.properties, fingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }) },
  object,
);
export type RemoteMcpTrustInput = Static<typeof RemoteMcpTrustInputSchema>;
export const McpImportDocumentSchema = Type.Object(
  {
    version: Type.Literal(1),
    local: Type.Array(McpServerInputSchema, { maxItems: 32 }),
    remote: Type.Array(RemoteMcpInputSchema, { maxItems: 32 }),
  },
  object,
);
export type McpImportDocument = Static<typeof McpImportDocumentSchema>;
export const McpReadOnlyGrantViewSchema = Type.Object(
  {
    id,
    remoteToolName: Type.String(),
    argumentsHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    definitionFingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    grantedAt: Type.Integer({ minimum: 0 }),
  },
  object,
);
export type McpReadOnlyGrantView = Static<typeof McpReadOnlyGrantViewSchema>;
export const McpImportPreviewSchema = Type.Object(
  {
    local: Type.Array(Type.String()),
    remote: Type.Array(Type.String()),
    warnings: Type.Array(Type.String()),
  },
  object,
);
export type McpImportPreview = Static<typeof McpImportPreviewSchema>;
