import type { SearchHit, SearchScope, SearchSourceRef } from '../search/search';

/** Only the host chooses the authenticated owner and permits cross-workspace human filters. */
export interface SearchAccess {
  ownerUserId: string;
  scope: SearchScope;
  userMemoryIds?: readonly string[];
  excludeSessionId?: string;
}

export interface SearchSourceMembership {
  branchId: string;
  taskId: string | null;
  ordinal: number;
}

/** One bounded persisted source; original provider codecs, live deltas and thinking are excluded. */
export interface SearchSourceSnapshot {
  source: SearchSourceRef;
  revision: number;
  title: string;
  text: string;
  workspaceId: string | null;
  sessionId: string | null;
  messageId: string | null;
  memoryId: string | null;
  origin: SearchHit['origin'];
  status: string;
  createdAt: number;
  memberships: SearchSourceMembership[];
}

export interface SearchSourcePage {
  items: SearchSourceSnapshot[];
  next: string | null;
}

export interface SearchChunkInput {
  ordinal: number;
  start: number;
  end: number;
  text: string;
  tokens: string;
}

export interface SearchChunkWrite {
  generation: number;
  source: SearchSourceRef;
  signature: string;
  chunks: readonly SearchChunkInput[];
}

export interface SearchVectorWrite {
  generation: number;
  source: SearchSourceRef;
  signature: string;
  modelSignature: string;
  dimensions: number;
  vectors: readonly { ordinal: number; vector: readonly number[] }[];
}

export interface SearchLexicalCandidate {
  chunkId: number;
  source: SearchSourceRef;
  start: number;
  end: number;
  text: string;
  rank: number;
}

export interface SearchVectorRow {
  chunkId: number;
  source: SearchSourceRef;
  start: number;
  end: number;
  text: string;
  vector: number[];
}

export interface SearchVectorPage {
  items: SearchVectorRow[];
  next: number | null;
}

export interface SearchQueryReadiness {
  generation: number;
  complete: boolean;
  vectorsComplete?: boolean;
}

export interface SearchPendingVectorChunk {
  ordinal: number;
  start: number;
  end: number;
  text: string;
}
