export { MemoryService, DEFAULT_MEMORY_SETTINGS } from './service';
export { MemoryError, type MemoryErrorCode } from './errors';
export { selectMemories, type MemorySelectionOptions } from './selection';
export {
  normalizeMemorySave,
  normalizeMemoryUpdate,
  normalizeMemoryDelete,
  memoryMutationFingerprint,
  type MemoryAgentOperation,
  type NormalizedMemorySave,
} from './mutations';
export type {
  MemoryRepository,
  MemoryCreateRecord,
  MemoryUpdateRecord,
  MemoryForgetRecord,
  MemorySettingsRecord,
  MemoryServiceOptions,
  MemoryAgentMutationRecord,
} from './ports';
