import { Type, type Static } from 'typebox';
import { ToolDiscoveryDiagnosticSchema } from '../extensions/mcp';
import { FrozenMcpToolsSchema } from './frozen-tools';
import { FrozenSkillSchema, SkillCandidatesSchema } from './skills';
import { SearchSourceSelectionSchema } from '../search/search';

export type QueueCapabilityMetadata = Static<typeof QueueCapabilityMetadataSchema>;

/** Accepted queue authority is private journal data, validated when written or read from storage. */
export const QueueCapabilityMetadataSchema = Type.Object(
  {
    version: Type.Literal(1),
    requestId: Type.String({ minLength: 1 }),
    searchQuotes: Type.Optional(
      Type.Array(SearchSourceSelectionSchema, { maxItems: 4, uniqueItems: true }),
    ),
    mcpBindings: FrozenMcpToolsSchema,
    candidateBindings: FrozenMcpToolsSchema,
    skillBindings: Type.Array(FrozenSkillSchema, { maxItems: 16 }),
    skillCandidates: SkillCandidatesSchema,
    discoveryDiagnostics: Type.Array(ToolDiscoveryDiagnosticSchema, { maxItems: 512 }),
    mentionedSkillBindings: Type.Array(FrozenSkillSchema, { maxItems: 16 }),
    inheritedSkillBindings: Type.Array(FrozenSkillSchema, { maxItems: 16 }),
  },
  { additionalProperties: false },
);
