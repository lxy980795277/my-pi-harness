import type {
  MemoryEntry,
  MemoryMutationResult,
  MemoryListInput,
  MemoryPage,
  MemoryCurrentStatus,
  MemorySettings,
  MemorySettingsInput,
  MemoryUpdateInput,
  MemoryForgetInput,
  MemoryMessageSource,
  MemoryAgentUpdateInput,
  MemoryAgentDeleteInput,
} from '@my-pi-harness/protocol';
import type {
  MemoryAccess,
  MemoryRepositorySnapshot,
  MemoryMutationAccess,
} from '@my-pi-harness/protocol/internal';
import type { NormalizedMemorySave } from './mutations';

export interface MemoryCreateRecord {
  requestId: string;
  fingerprint: string;
  entry: MemoryEntry;
}

export interface MemoryUpdateRecord extends MemoryUpdateInput {
  fingerprint: string;
  at: number;
  source?: MemoryMessageSource;
}

export interface MemoryForgetRecord extends MemoryForgetInput {
  fingerprint: string;
  at: number;
}

export interface MemorySettingsRecord extends MemorySettingsInput {
  fingerprint: string;
}

interface MemoryAgentRecord {
  access: MemoryMutationAccess;
  fingerprint: string;
  at: number;
}
export type MemoryAgentMutationRecord =
  | (MemoryAgentRecord & {
      operation: 'save' | 'learn';
      input: NormalizedMemorySave;
      memoryId: string;
    })
  | (MemoryAgentRecord & { operation: 'update'; input: MemoryAgentUpdateInput })
  | (MemoryAgentRecord & { operation: 'delete'; input: MemoryAgentDeleteInput });

/** Persistence owns atomic ownership/CAS/source checks and body-free durable receipts. */
export interface MemoryRepository {
  list(ownerUserId: string, input?: MemoryListInput): MemoryPage;
  entries(access: MemoryAccess, ids: readonly string[]): MemoryEntry[];
  statuses(ownerUserId: string, ids: readonly string[]): MemoryCurrentStatus[];
  readSnapshot(access: MemoryAccess, includeFixed?: boolean): MemoryRepositorySnapshot;
  create(ownerUserId: string, record: MemoryCreateRecord): MemoryMutationResult;
  update(ownerUserId: string, id: string, record: MemoryUpdateRecord): MemoryMutationResult;
  forget(ownerUserId: string, id: string, record: MemoryForgetRecord): MemoryMutationResult;
  getSettings(ownerUserId: string): MemorySettings | undefined;
  updateSettings(ownerUserId: string, record: MemorySettingsRecord): MemorySettings;
  mutateFromAgent(record: MemoryAgentMutationRecord): MemoryMutationResult;
}

/** Host services inject time and identities; production defaults do not alter persistence policy. */
export interface MemoryServiceOptions {
  now?: () => number;
  createId?: () => string;
}
