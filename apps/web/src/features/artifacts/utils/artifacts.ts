import type { Artifact, ToolCallView } from '@my-pi-harness/protocol';

/** Only persisted artifact metadata attached to a completed call can advertise a download. */
export const readToolArtifacts = (tool: ToolCallView): Artifact[] => {
  if (tool.status !== 'completed') return [];
  return tool.artifacts ?? [];
};

/** Browser download names never contain path separators or control characters. */
export const artifactFilename = (artifact: Artifact): string => {
  const filename = artifact.name.replaceAll('\\', '/').split('/').at(-1);
  if (filename === undefined || filename.length === 0) return 'artifact';
  return filename.replace(/[\u0000-\u001f\u007f]/g, '_');
};
