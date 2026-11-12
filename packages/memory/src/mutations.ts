import type {
  MemorySaveInput,
  MemoryAgentUpdateInput,
  MemoryAgentDeleteInput,
  MemoryMessageSource,
  MemoryMode,
} from '@my-pi-harness/protocol';
import { canonicalSource, fingerprint, normalizeBody } from './values';

export type MemoryAgentOperation = 'save' | 'learn' | 'update' | 'delete';
export type NormalizedMemorySave = MemorySaveInput & { mode: MemoryMode };

/** Explicit saves are fixed; automatic facts are relevant while preferences and instructions are fixed. */
export function normalizeMemorySave(
  input: MemorySaveInput,
  operation: 'save' | 'learn',
): NormalizedMemorySave {
  return {
    scope: input.scope,
    category: input.category,
    body: normalizeBody(input.body),
    mode: input.mode ?? (operation === 'learn' && input.category === 'fact' ? 'relevant' : 'fixed'),
  };
}

export function normalizeMemoryUpdate(input: MemoryAgentUpdateInput): MemoryAgentUpdateInput {
  return {
    memoryId: input.memoryId,
    expectedRevision: input.expectedRevision,
    category: input.category,
    body: normalizeBody(input.body),
    ...(input.mode === undefined ? {} : { mode: input.mode }),
  };
}

export function normalizeMemoryDelete(input: MemoryAgentDeleteInput): MemoryAgentDeleteInput {
  return { memoryId: input.memoryId, expectedRevision: input.expectedRevision };
}

/** Exact tool retries reuse their receipt even after the resulting memory has been forgotten. */
export function memoryMutationFingerprint(
  operation: MemoryAgentOperation,
  source: MemoryMessageSource,
  input: MemorySaveInput | MemoryAgentUpdateInput | MemoryAgentDeleteInput,
): string {
  return fingerprint([operation, canonicalSource(source), input]);
}
