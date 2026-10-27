import { type Static, Type } from 'typebox';

export type CustomProtocol = Static<typeof CustomProtocolSchema>;
export type ThinkingLevel = Static<typeof ThinkingLevelSchema>;
export type CompatOptions = Static<typeof CompatOptionsSchema>;
export type ModelDefinition = Static<typeof ModelDefinitionSchema>;
export type ModelInfo = Static<typeof ModelInfoSchema>;
export type ProviderConfig = Static<typeof ProviderConfigSchema>;
export type ProviderInput = Static<typeof ProviderInputSchema>;
export type NativeProviderInfo = Static<typeof NativeProviderInfoSchema>;
export type ConnectionResult = Static<typeof ConnectionResultSchema>;
export type DefaultModel = Static<typeof DefaultModelSchema>;
export type AppSettings = Static<typeof AppSettingsSchema>;
export type AppSettingsInput = Static<typeof AppSettingsInputSchema>;

const id = Type.String({ minLength: 1, maxLength: 160 });

/** API families accepted by explicitly configured custom providers. */
export const CustomProtocolSchema = Type.Union([
  Type.Literal('openai-completions'),
  Type.Literal('openai-responses'),
  Type.Literal('anthropic-messages'),
]);

/** Supported request options; model capability checks still run before execution. */
export const ThinkingLevelSchema = Type.Union([
  Type.Literal('off'),
  Type.Literal('minimal'),
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('xhigh'),
  Type.Literal('max'),
]);

/** Safe, explicit overrides for OpenAI-compatible dialects. */
export const CompatOptionsSchema = Type.Object(
  {
    supportsStore: Type.Optional(Type.Boolean()),
    supportsDeveloperRole: Type.Optional(Type.Boolean()),
    supportsReasoningEffort: Type.Optional(Type.Boolean()),
    supportsUsageInStreaming: Type.Optional(Type.Boolean()),
    requiresReasoningContentOnAssistantMessages: Type.Optional(Type.Boolean()),
    supportsStrictMode: Type.Optional(Type.Boolean()),
    maxTokensField: Type.Optional(
      Type.Union([Type.Literal('max_tokens'), Type.Literal('max_completion_tokens')]),
    ),
  },
  { additionalProperties: false },
);

/** Model metadata contains no instantiated SDK objects or authorization headers. */
export const ModelDefinitionSchema = Type.Object(
  {
    id,
    name: Type.String({ minLength: 1, maxLength: 200 }),
    api: Type.String({ minLength: 1, maxLength: 80 }),
    contextWindow: Type.Integer({ minimum: 1024, maximum: 10_000_000 }),
    maxTokens: Type.Integer({ minimum: 1, maximum: 10_000_000 }),
    reasoning: Type.Boolean(),
    input: Type.Array(Type.Union([Type.Literal('text'), Type.Literal('image')]), {
      minItems: 1,
      maxItems: 2,
    }),
    compat: Type.Optional(CompatOptionsSchema),
    headers: Type.Optional(
      Type.Record(
        Type.String({
          pattern:
            '^(?!.*(?:[Aa][Uu][Tt][Hh]|[Cc][Oo][Oo][Kk][Ii][Ee]|[Kk][Ee][Yy]|[Tt][Oo][Kk][Ee][Nn]))[A-Za-z0-9-]+$',
        }),
        Type.String({ maxLength: 4096 }),
      ),
    ),
  },
  { additionalProperties: false },
);

/** Runtime capability catalog; configured definitions remain separate from these derived fields. */
export const ModelInfoSchema = Type.Object(
  {
    ...ModelDefinitionSchema.properties,
    supportedThinkingLevels: Type.Array(ThinkingLevelSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

const providerFields = {
  name: Type.String({ minLength: 1, maxLength: 100 }),
  kind: Type.Union([Type.Literal('builtin'), Type.Literal('custom')]),
  builtinId: Type.Union([id, Type.Null()]),
  api: Type.Union([CustomProtocolSchema, Type.Null()]),
  baseUrl: Type.Union([Type.String({ minLength: 1, maxLength: 2048 }), Type.Null()]),
  models: Type.Array(ModelDefinitionSchema, { maxItems: 100 }),
  enabled: Type.Boolean(),
  requiresApiKey: Type.Boolean(),
};

/** Stored non-secret provider configuration and computed credential availability. */
export const ProviderConfigSchema = Type.Object(
  {
    id,
    ...providerFields,
    models: Type.Array(ModelDefinitionSchema),
    credentialRef: id,
    revision: Type.Integer({ minimum: 1 }),
    hasCredential: Type.Boolean(),
    credentialType: Type.Union([Type.Literal('api_key'), Type.Literal('oauth'), Type.Null()]),
    legacy: Type.Boolean(),
    configured: Type.Boolean(),
    authSource: Type.Union([
      Type.Literal('api_key'),
      Type.Literal('oauth'),
      Type.Literal('none'),
      Type.Null(),
    ]),
    credentialPreview: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
  },
  { additionalProperties: false },
);

/** Creation/update request; optimistic revisions reject stale settings edits. */
export const ProviderInputSchema = Type.Object(
  {
    id: Type.Optional(id),
    ...providerFields,
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

/** Available built-in integrations and their declared login methods. */
export const NativeProviderInfoSchema = Type.Object(
  {
    id,
    name: Type.String(),
    authKinds: Type.Array(Type.Union([Type.Literal('api_key'), Type.Literal('oauth')])),
  },
  { additionalProperties: false },
);

/** A connection probe result is separate from saving settings. */
export const ConnectionResultSchema = Type.Object(
  { ok: Type.Boolean(), message: Type.String() },
  { additionalProperties: false },
);

/** Default selection is applied only when a new session omits an explicit model. */
export const DefaultModelSchema = Type.Object(
  { providerId: id, modelId: id, thinkingLevel: ThinkingLevelSchema },
  { additionalProperties: false },
);

/** Profile-wide defaults and the revision used for optimistic settings changes. */
export const AppSettingsSchema = Type.Object(
  {
    revision: Type.Integer({ minimum: 1 }),
    defaultModel: Type.Union([DefaultModelSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

/** Explicitly set or clear the future-session default without altering existing sessions. */
export const AppSettingsInputSchema = Type.Object(
  {
    expectedRevision: Type.Integer({ minimum: 1 }),
    defaultModel: Type.Union([DefaultModelSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
