import { type Static, Type } from 'typebox';

export type WebSearchInput = Static<typeof WebSearchInputSchema>;
export type WebServiceStatus = Static<typeof WebServiceStatusSchema>;
export type WebCredentialInput = Static<typeof WebCredentialInputSchema>;

const SEARCH_TEXT_OPTIONS = { minLength: 1, maxLength: 128, pattern: '\\S' };

/** Public search options; provider credentials are never model parameters. */
export const WebSearchInputSchema = Type.Object(
  {
    query: Type.String({
      ...SEARCH_TEXT_OPTIONS,
      description:
        'Search query containing 1–128 Unicode characters, not only whitespace. Supports site:, -site:, quoted phrases, exclusions, lang:, after: and before:.',
    }),
    count: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 50,
        description: 'Requested number of results, from 1 to 50. Defaults to 10.',
      }),
    ),
    oriQuestion: Type.Optional(
      Type.String({
        ...SEARCH_TEXT_OPTIONS,
        description:
          'Original user question that triggered this search, to clarify intent. Omit when unnecessary; at most 128 Unicode characters.',
      }),
    ),
    localization: Type.Optional(
      Type.String({
        maxLength: 128,
        description:
          'IP address used to prioritize geographically relevant results. This is not a city or country name. Omit or use an empty string for no localization hint.',
      }),
    ),
    needContent: Type.Optional(
      Type.Boolean({
        description:
          'Include available webpage body content in search results. Defaults to false. Content may be missing or truncated; use web_fetch mode="page" to read a selected page.',
      }),
    ),
  },
  { additionalProperties: false },
);

/** Settings expose credential availability without credential bytes or references. */
export const WebServiceStatusSchema = Type.Object(
  { provider: Type.Literal('deepseek'), configured: Type.Boolean() },
  { additionalProperties: false },
);

/** A write-only official DeepSeek credential, separate from chat model configuration. */
export const WebCredentialInputSchema = Type.Object(
  { apiKey: Type.String({ minLength: 1, maxLength: 4096, pattern: '^[!-~]+$' }) },
  { additionalProperties: false },
);
