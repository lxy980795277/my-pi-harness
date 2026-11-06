import type { PluginInstallation } from '@my-pi-harness/protocol/internal';
/** The host persists revisions atomically and rejects stale writes. */
export interface PluginRepository {
  plugins(): PluginInstallation[];
  savePlugin(input: PluginInstallation, expectedRevision: number | null): PluginInstallation;
  removePlugin(id: string, expectedRevision: number): void;
}

/** Skill resource leases stay owned by the generic Skills service. */
export interface PluginSkillsPort {
  assertRemovable(id: string): void;
}
