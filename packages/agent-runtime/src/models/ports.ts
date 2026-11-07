import type { AppSettings, AppSettingsInput } from '@my-pi-harness/protocol';
import type { ProviderRecord } from '@my-pi-harness/protocol/internal';

/** Host-owned provider records carry opaque references; credential bytes remain separately owned. */
export interface ProviderStore {
  listProviders(): ProviderRecord[];
  getProvider(id: string): ProviderRecord | undefined;
  putProvider(input: ProviderRecord, expectedRevision?: number): ProviderRecord;
  deleteProvider(id: string): void;
  getBuiltinProviderId(builtinId: string): string | undefined;
  bindBuiltinProvider(builtinId: string, providerId: string): void;
  getSettings(): AppSettings;
  putSettings(input: AppSettingsInput): AppSettings;
}
