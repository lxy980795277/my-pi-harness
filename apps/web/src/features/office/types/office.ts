import type { OfficeArtifact, ToolCallView } from '@my-pi-harness/protocol';
import type { Action } from '@/types/events';
export interface OfficeArtifactProps {
  tool: ToolCallView;
}
export interface OfficeArtifactState {
  artifact: OfficeArtifact | null;
  filename: string;
  download: Action;
  pending: boolean;
  error: string | null;
}
