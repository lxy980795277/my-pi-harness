import type {
  FrozenSkill as ProtocolFrozenSkill,
  SkillResource,
  SkillScope,
} from '@my-pi-harness/protocol';
export type { SkillResource, SkillScope, SkillResourceContent } from '@my-pi-harness/protocol';

/** Source snapshots do not own the gateway URL later attached by the daemon. */
export type FrozenSkill = Omit<ProtocolFrozenSkill, 'gatewayUrl'>;

/** Scope precedence is project, user, plugin, system; directories within a scope are explicit. */
export interface SkillRoot {
  path: string;
  scope: SkillScope;
  pluginId: string | null;
  workspaceId: string | null;
  managed: boolean;
}
export interface ParsedSkill {
  name: string;
  description: string;
  content: string;
  allowedTools: string[];
}
export interface DiscoveredSkill extends ParsedSkill {
  id: string;
  scope: SkillScope;
  pluginId: string | null;
  workspaceId: string | null;
  root: string;
  directory: string;
  contentHash: string;
  resources: SkillResource[];
  managed: boolean;
  shadowed: boolean;
  source: string;
}
export interface SkillCatalogOptions {
  snapshotDirectory: string;
}
export interface GitHubSkillSource {
  owner: string;
  repository: string;
  ref: string;
  path: string;
}
export interface SkillDownloadFile {
  path: string;
  content: Uint8Array;
}
