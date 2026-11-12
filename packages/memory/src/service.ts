import { randomUUID } from 'node:crypto';
import type {
  MemoryCreateInput,
  MemoryEntry,
  MemoryForgetInput,
  MemoryMutationResult,
  MemorySettings,
  MemorySettingsInput,
  MemoryUpdateInput,
  MemoryListInput,
  MemoryPage,
  MemoryCurrentStatus,
  MemorySaveInput,
  MemoryAgentUpdateInput,
  MemoryAgentDeleteInput,
} from '@my-pi-harness/protocol';
import type {
  MemoryAccess,
  MemoryRecallSnapshot,
  MemoryRecallCandidate,
  MemoryRequestSnapshot,
  MemoryMutationAccess,
} from '@my-pi-harness/protocol/internal';
import type { MemoryRepository, MemoryServiceOptions } from './ports';
import { selectMemories, type MemorySelectionOptions } from './selection';
import { canonicalScope, canonicalSource, fingerprint, normalizeBody } from './values';
import {
  normalizeMemorySave,
  normalizeMemoryUpdate,
  normalizeMemoryDelete,
  memoryMutationFingerprint,
} from './mutations';

/** Defaults are domain policy and remain unpersisted until a person changes them. */
export const DEFAULT_MEMORY_SETTINGS: Readonly<MemorySettings> = Object.freeze({
  allowUse: true,
  allowLearning: true,
  revision: 0,
});

/** Independent memories, direct Agent writes and recall selection, independent of transport and Agent execution. */
export class MemoryService {
  private readonly now: () => number;
  private readonly createId: () => string;

  public constructor(
    private readonly repository: MemoryRepository,
    options: MemoryServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
  }

  public list(ownerUserId: string, input?: MemoryListInput): MemoryPage {
    return this.repository.list(ownerUserId, input);
  }

  public entries(access: MemoryAccess, ids: readonly string[]): MemoryEntry[] {
    return this.repository.entries(access, ids);
  }
  public statuses(ownerUserId: string, ids: readonly string[]): MemoryCurrentStatus[] {
    return this.repository.statuses(ownerUserId, ids);
  }

  public saveFromAgent(input: MemorySaveInput, access: MemoryMutationAccess): MemoryMutationResult {
    return this.createFromAgent('save', input, access);
  }

  public learnFromAgent(
    input: MemorySaveInput,
    access: MemoryMutationAccess,
  ): MemoryMutationResult {
    return this.createFromAgent('learn', input, access);
  }

  public updateFromAgent(
    input: MemoryAgentUpdateInput,
    access: MemoryMutationAccess,
  ): MemoryMutationResult {
    const value = normalizeMemoryUpdate(input);
    return this.repository.mutateFromAgent({
      operation: 'update',
      input: value,
      access,
      at: this.now(),
      fingerprint: memoryMutationFingerprint('update', access.source, value),
    });
  }

  public deleteFromAgent(
    input: MemoryAgentDeleteInput,
    access: MemoryMutationAccess,
  ): MemoryMutationResult {
    const value = normalizeMemoryDelete(input);
    return this.repository.mutateFromAgent({
      operation: 'delete',
      input: value,
      access,
      at: this.now(),
      fingerprint: memoryMutationFingerprint('delete', access.source, value),
    });
  }

  private createFromAgent(
    operation: 'save' | 'learn',
    input: MemorySaveInput,
    access: MemoryMutationAccess,
  ): MemoryMutationResult {
    const value = normalizeMemorySave(input, operation);
    return this.repository.mutateFromAgent({
      operation,
      input: value,
      access,
      at: this.now(),
      memoryId: this.createId(),
      fingerprint: memoryMutationFingerprint(operation, access.source, value),
    });
  }

  public create(ownerUserId: string, input: MemoryCreateInput): MemoryMutationResult {
    const body = normalizeBody(input.body);
    const source = canonicalSource(input.source);
    const at = this.now();
    const value = {
      scope: canonicalScope(input.scope),
      category: input.category,
      body,
      enabled: input.enabled,
      mode: input.mode ?? 'fixed',
      source,
    };
    return this.repository.create(ownerUserId, {
      requestId: input.requestId,
      fingerprint: fingerprint(['create', value]),
      entry: { ...value, id: this.createId(), revision: 1, createdAt: at, updatedAt: at },
    });
  }

  public update(ownerUserId: string, id: string, input: MemoryUpdateInput): MemoryMutationResult {
    const value = { ...input, body: normalizeBody(input.body) };
    return this.repository.update(ownerUserId, id, {
      ...value,
      fingerprint: fingerprint([
        'update',
        id,
        input.expectedRevision,
        input.category,
        value.body,
        input.enabled,
        input.mode ?? null,
      ]),
      at: this.now(),
    });
  }

  public forget(ownerUserId: string, id: string, input: MemoryForgetInput): MemoryMutationResult {
    return this.repository.forget(ownerUserId, id, {
      ...input,
      fingerprint: fingerprint(['forget', id, input.expectedRevision]),
      at: this.now(),
    });
  }

  public settings(ownerUserId: string): MemorySettings {
    return this.repository.getSettings(ownerUserId) ?? { ...DEFAULT_MEMORY_SETTINGS };
  }

  public updateSettings(ownerUserId: string, input: MemorySettingsInput): MemorySettings {
    return this.repository.updateSettings(ownerUserId, {
      ...input,
      fingerprint: fingerprint([
        'settings',
        input.expectedRevision,
        input.allowUse,
        input.allowLearning,
      ]),
    });
  }

  /** Read one consistent legal candidate set; disabled entries also participate in invalidation. */
  public snapshot(access: MemoryAccess, includeFixed = true): MemoryRecallSnapshot {
    const snapshot = this.repository.readSnapshot(access, includeFixed);
    const settings = snapshot.settings ?? DEFAULT_MEMORY_SETTINGS;
    return {
      access,
      settings: { ...settings },
      fixed: snapshot.entries,
      candidates: snapshot.candidates,
      fingerprint: fingerprint([
        access.ownerUserId,
        access.workspaceId,
        access.includeUser,
        [...(access.userMemoryIds ?? [])].sort(),
        settings,
        snapshot.candidates,
      ]),
    };
  }

  public select(
    snapshot: MemoryRecallSnapshot,
    candidates: readonly MemoryRecallCandidate[],
    options: MemorySelectionOptions,
  ): MemoryRequestSnapshot {
    return {
      ...selectMemories(snapshot, candidates, options),
      policy: {
        allowUse: snapshot.settings.allowUse,
        allowLearning: snapshot.settings.allowLearning,
      },
    };
  }

  public isCurrent(access: MemoryAccess, expectedFingerprint: string): boolean {
    return this.snapshot(access, false).fingerprint === expectedFingerprint;
  }
}
