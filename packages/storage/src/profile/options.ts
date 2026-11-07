import type { AgentSettings } from '@my-pi-harness/protocol';
import type { ArtifactLimits } from '../artifacts/blobs';

/** Host-selected storage limits and defaults; changing log placement does not relocate credentials. */
export interface ProfileStoreOptions {
  sessionLogRoot?: string;
  artifactLimits?: ArtifactLimits;
  /** Runtime-owned defaults are resolved only when no settings have been stored. */
  defaultAgentSettings?: () => AgentSettings;
}
