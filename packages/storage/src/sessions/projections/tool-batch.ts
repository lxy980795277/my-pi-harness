import { Type } from 'typebox';
import {
  ArtifactPublishedSchema,
  type ToolCallRecord,
  type Artifact,
} from '@my-pi-harness/protocol';
import { StoredToolResultSchema } from '@my-pi-harness/protocol/internal';
import { checked } from '../../shared/validation';
import { StorageError } from '../../shared/errors';
import { ToolContextEventSchema, ToolEventSchema } from '../event-validation';

interface BatchRecord {
  type: string;
  data: Record<string, unknown>;
  privateData?: Record<string, unknown> | null;
}

const ContextSchema = Type.Pick(ToolContextEventSchema, ['toolCallId'], {
  additionalProperties: true,
});

export function activeTool(status: ToolCallRecord['status']): boolean {
  return status === 'running' || status === 'reviewing' || status === 'awaiting_approval';
}

/** Terminal public outcomes and their canonical private results form one journal transaction. */
export function validateToolBatch(records: readonly BatchRecord[]): void {
  const terminals = new Set<string>();
  const contexts = new Set<string>();
  const artifactTools = new Map<string, ToolCallRecord>();
  const artifacts = new Map<string, Artifact>();
  for (const record of records) {
    if (record.type === 'tool.updated' || record.type === 'tool.requested') {
      const { tool } = checked(ToolEventSchema, record.data);
      if ((tool.artifacts?.length ?? 0) > 0) {
        if (tool.status !== 'completed')
          throw new StorageError('INVALID_EVENT', 'Artifact metadata requires a completed tool');
        artifactTools.set(tool.id, tool);
      }
      if (!activeTool(tool.status)) {
        if (terminals.has(tool.id))
          throw new StorageError(
            'INVALID_EVENT',
            'A tool can have only one terminal outcome in a batch',
          );
        terminals.add(tool.id);
      }
    }
    if (record.type === 'artifact.published') {
      const { artifact } = checked(ArtifactPublishedSchema, record.data);
      if (artifacts.has(artifact.id))
        throw new StorageError('INVALID_EVENT', 'Artifact publication is duplicated');
      artifacts.set(artifact.id, artifact);
    }
    if (record.type !== 'tool.context') continue;
    const { toolCallId } = checked(ContextSchema, record.data);
    if (contexts.has(toolCallId))
      throw new StorageError('INVALID_EVENT', 'A tool result cannot be duplicated');
    contexts.add(toolCallId);
    if (record.privateData === undefined || record.privateData === null)
      throw new StorageError('INVALID_EVENT', 'Tool result requires canonical private content');
    checked(StoredToolResultSchema, record.privateData);
  }
  for (const id of terminals)
    if (!contexts.has(id))
      throw new StorageError(
        'INVALID_EVENT',
        'Tool terminal outcome and private result must be committed together',
      );
  for (const id of contexts)
    if (!terminals.has(id))
      throw new StorageError(
        'INVALID_EVENT',
        'Tool result requires its terminal outcome in the same batch',
      );
  const expectedArtifacts = new Set<string>();
  for (const tool of artifactTools.values()) {
    for (const artifact of tool.artifacts ?? []) {
      if (
        expectedArtifacts.has(artifact.id) ||
        artifact.sessionId !== tool.sessionId ||
        artifact.runId !== tool.runId ||
        artifact.toolCallId !== tool.id ||
        JSON.stringify(artifacts.get(artifact.id)) !== JSON.stringify(artifact)
      )
        throw new StorageError(
          'INVALID_EVENT',
          'Artifact fact and completed tool must be committed together',
        );
      expectedArtifacts.add(artifact.id);
    }
  }
  if (expectedArtifacts.size !== artifacts.size)
    throw new StorageError(
      'INVALID_EVENT',
      'Artifact publication requires its completed tool in the same batch',
    );
}
