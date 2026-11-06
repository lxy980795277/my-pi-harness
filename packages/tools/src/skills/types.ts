import type { SkillResource, SkillScope } from '@my-pi-harness/protocol';
import type { FrozenSkill as ProtocolFrozenSkill } from '@my-pi-harness/protocol/internal';
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
  /** Host-managed resource copies must live outside every protected profile directory. */
  materializationDirectory?: string;
  protectedDirectories?: readonly string[];
  /** Exact host-registered dependencies; Skill manifests cannot select arbitrary files. */
  resourceSources?: SkillResourceSources;
}
export type SkillResourceSources = Readonly<
  Record<string, { readonly directory: string; readonly path: string }>
>;
/** The host rechecks activation and current Skill/plugin epochs before each new dispatch. */
export type AssertSkillAuthorized = (skill: FrozenSkill, signal: AbortSignal) => Promise<void>;
/** A command receives its own lease; releasing a Run cannot reclaim that command's resources. */
export interface SkillResourceLease {
  readonly bindings: readonly MaterializedSkillBinding[];
  readonly readOnlyDirectories: readonly string[];
  verify(signal: AbortSignal): Promise<void>;
  retain(signal: AbortSignal): Promise<SkillResourceLease>;
  release(): Promise<void>;
}
export interface MaterializedSkillBinding {
  readonly selection: Readonly<FrozenSkill['selection']>;
  readonly directory: string;
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
