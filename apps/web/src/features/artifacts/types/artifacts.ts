import type { Artifact, ToolCallView } from '@my-pi-harness/protocol';
import type { Action } from '@/types/events';

export interface ArtifactCardProps {
  artifact: Artifact;
}
export interface ToolArtifactsProps {
  tool: ToolCallView;
}
export interface ArtifactDownloadState {
  filename: string;
  download: Action;
  pending: boolean;
  error: string | null;
}
