/** Scope precedence is project, user, plugin, system; directories within a scope are explicit. */
export type SkillScope = 'project' | 'user' | 'plugin' | 'system';
export interface SkillRoot {
  path: string;
  scope: SkillScope;
  pluginId: string | null;
  workspaceId: string | null;
  managed: boolean;
}
export interface SkillSelection {
  id: string;
  contentHash: string;
}
export interface SkillResource {
  path: string;
  hash: string;
  size: number;
  mediaType: string;
}
export interface FrozenSkill {
  selection: SkillSelection;
  authorization: {
    skillEpoch: number;
    pluginId: string | null;
    pluginEpoch: number;
    pluginGeneration: string | null;
  };
  name: string;
  description: string;
  scope: SkillScope;
  source: string;
  content: string;
  resources: SkillResource[];
  allowedTools: string[];
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
export type SkillResourceContent =
  | { type: 'text'; text: string; path: string; hash: string }
  | { type: 'image'; data: string; mimeType: string; path: string; hash: string };
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
