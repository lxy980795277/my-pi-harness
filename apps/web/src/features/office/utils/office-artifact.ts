import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  OfficeArtifactSchema,
  type OfficeArtifact,
  type ToolCallView,
} from '@my-pi-harness/protocol';

const WRITING_TOOLS = new Set([
  'office_docx',
  'office_pdf',
  'office_xlsx',
  'office_pptx',
  'office_render',
]);
const EnvelopeSchema = Type.Object({ artifact: OfficeArtifactSchema });
const MEDIA_TYPES: Record<OfficeArtifact['format'], string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
/** Only completed native Office results can advertise a validated workspace artifact. */
export const readOfficeArtifact = (tool: ToolCallView): OfficeArtifact | null => {
  if (
    tool.status !== 'completed' ||
    !WRITING_TOOLS.has(tool.name) ||
    tool.binding.kind !== 'accepted' ||
    tool.binding.source.kind !== 'workspace' ||
    tool.result === null
  )
    return null;
  const lines = tool.result.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line === undefined || line.length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (Value.Check(EnvelopeSchema, value)) return value.artifact;
  }
  return null;
};
export const officeArtifactMediaType = (artifact: OfficeArtifact): string => {
  return MEDIA_TYPES[artifact.format];
};
export const officeArtifactFilename = (artifact: OfficeArtifact): string => {
  const filename = artifact.path.replaceAll('\\', '/').split('/').at(-1);
  if (filename === undefined || filename.length === 0) return `document.${artifact.format}`;
  return filename.replace(/[\u0000-\u001f\u007f]/g, '_');
};
