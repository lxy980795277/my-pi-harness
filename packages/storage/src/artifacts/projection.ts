import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  ArtifactPublishedSchema,
  RunViewSchema,
  ToolCallRecordSchema,
  type HarnessEvent,
} from '@my-pi-harness/protocol';
import * as schema from '../sqlite/schema.js';
import { checked } from '../shared/validation.js';
import { StorageError } from '../shared/errors.js';

/** Publication provenance is checked against the owning tool and Run before indexing the committed fact. */
export function projectArtifact(
  db: BetterSQLite3Database<typeof schema>,
  event: HarnessEvent,
): void {
  const { artifact } = checked(ArtifactPublishedSchema, event.data);
  const runRow = db.select().from(schema.runs).where(eq(schema.runs.id, artifact.runId)).get();
  const toolRow = db
    .select()
    .from(schema.toolCalls)
    .where(eq(schema.toolCalls.id, artifact.toolCallId))
    .get();
  const session = db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, event.sessionId))
    .get();
  if (runRow === undefined || toolRow === undefined || session === undefined)
    throw new StorageError(
      'INVALID_EVENT',
      'Artifact publication requires an existing Run and tool',
    );
  const run = checked(RunViewSchema, runRow.data);
  const tool = checked(ToolCallRecordSchema, toolRow.data);
  if (
    artifact.sessionId !== event.sessionId ||
    artifact.runId !== event.runId ||
    run.sessionId !== event.sessionId ||
    run.status !== 'running' ||
    (run.taskId ?? null) !== artifact.taskId ||
    session.workspaceId !== artifact.workspaceId ||
    tool.sessionId !== event.sessionId ||
    tool.runId !== artifact.runId ||
    tool.status !== 'completed' ||
    tool.binding.kind !== 'accepted' ||
    tool.binding.source.kind === 'mcp' ||
    tool.artifacts?.some(
      (entry) => entry.id === artifact.id && JSON.stringify(entry) === JSON.stringify(artifact),
    ) !== true
  )
    throw new StorageError(
      'INVALID_EVENT',
      'Artifact publication does not match its completed host tool',
    );
  db.insert(schema.artifacts)
    .values({
      id: artifact.id,
      sessionId: artifact.sessionId,
      runId: artifact.runId,
      toolCallId: artifact.toolCallId,
      sha256: artifact.sha256,
      data: artifact,
    })
    .run();
}
