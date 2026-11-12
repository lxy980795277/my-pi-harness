import { type Static, Type } from 'typebox';
import {
  MemoryAdoptedEntrySchema,
  MemorySelectionSchema,
  type MemoryEntry,
  type MemorySettings,
  type MemoryScope,
  type MemoryMode,
  type MemoryMessageSource,
} from '../memory/memory';

export type MemoryRequestSnapshot = Static<typeof MemoryRequestSnapshotSchema>;
export type MemoryPromptRange = Static<typeof MemoryPromptRangeSchema>;

/** Host-selected access for one root or child request; never populated from model arguments. */
export interface MemoryAccess {
  ownerUserId: string;
  workspaceId: string | null;
  includeUser: boolean;
  userMemoryIds?: readonly string[];
}

export interface MemoryCandidateKey {
  id: string;
  revision: number;
  scope: MemoryScope;
  mode: MemoryMode;
  enabled: boolean;
}

export interface MemoryRecallSnapshot {
  access: MemoryAccess;
  fingerprint: string;
  settings: MemorySettings;
  fixed: MemoryEntry[];
  candidates: MemoryCandidateKey[];
}

export interface MemoryRecallCandidate {
  entry: MemoryEntry;
  /** Probability from a complete local relevance check; absent means the candidate is unverified. */
  relevanceScore?: number;
}

/** Runtime supplies consumed input identity; models cannot construct this authority. */
export interface MemoryMutationAccess {
  ownerUserId: string;
  sessionId: string;
  branchId: string;
  runId: string;
  source: MemoryMessageSource;
  toolCallId: string;
}

/** Entries and settings are read from the same SQLite snapshot before domain selection. */
export interface MemoryRepositorySnapshot {
  settings: MemorySettings | null;
  entries: MemoryEntry[];
  candidates: MemoryCandidateKey[];
}

/** Durable request metadata references the only memory body copy in the final system prompt. */
export const MemoryPromptRangeSchema = Type.Object(
  {
    start: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    end: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  },
  { additionalProperties: false },
);

/** A historical snapshot is structurally bounded independently of today's recall policy. */
export const MemoryRequestSnapshotSchema = Type.Object(
  {
    fingerprint: Type.String({ pattern: '^[0-9a-f]{64}$' }),
    entries: Type.Array(MemoryAdoptedEntrySchema, { maxItems: 108 }),
    selection: Type.Optional(MemorySelectionSchema),
    policy: Type.Optional(
      Type.Object(
        { allowUse: Type.Boolean(), allowLearning: Type.Boolean() },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
