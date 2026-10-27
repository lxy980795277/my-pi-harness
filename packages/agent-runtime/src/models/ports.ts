import type { AppSettings, AppSettingsInput, ProviderConfig } from '@my-pi-harness/protocol';

/** Non-secret provider metadata, independently versioned from credentials. */
export interface ProviderStore {
  listProviders(): ProviderConfig[];
  getProvider(id: string): ProviderConfig | undefined;
  putProvider(input: ProviderConfig, expectedRevision?: number): ProviderConfig;
  deleteProvider(id: string): void;
  getBuiltinProviderId(builtinId: string): string | undefined;
  bindBuiltinProvider(builtinId: string, providerId: string): void;
  getSettings(): AppSettings;
  putSettings(input: AppSettingsInput): AppSettings;
}
