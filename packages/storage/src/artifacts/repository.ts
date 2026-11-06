import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  ArtifactSchema,
  ArtifactPublishedSchema,
  type Artifact,
  type HarnessEvent,
  type ToolCallView,
} from '@my-pi-harness/protocol';
import type { EventInput } from '@my-pi-harness/protocol/internal';
import { StorageError } from '../shared/errors';
import { checked } from '../shared/validation';
import * as schema from '../sqlite/schema';
import type { ArtifactBlobs } from './blobs';

/** Queries publication provenance and manages references to immutable artifact bytes. */
export class ArtifactRepository {
  public constructor(
    private readonly db: BetterSQLite3Database<typeof schema>,
    private readonly artifactBlobs: ArtifactBlobs,
    private readonly visibleTool: (sessionId: string, toolId: string) => ToolCallView | undefined,
  ) {}

  /** Only committed, currently visible root or child publications are downloadable. */
  public get(sessionId: string, artifactId: string): Artifact | undefined {
    const row = this.db
      .select()
      .from(schema.artifacts)
      .where(and(eq(schema.artifacts.id, artifactId), eq(schema.artifacts.sessionId, sessionId)))
      .get();
    if (row === undefined) return undefined;
    const artifact = checked(ArtifactSchema, row.data);
    if (
      artifact.id !== row.id ||
      artifact.sessionId !== row.sessionId ||
      artifact.runId !== row.runId ||
      artifact.toolCallId !== row.toolCallId ||
      artifact.sha256 !== row.sha256
    )
      throw new StorageError('INVALID_RECORD', 'Artifact index does not match its publication');
    const tool = this.visibleTool(sessionId, artifact.toolCallId);
    if (tool === undefined) return undefined;
    if (
      tool.status !== 'completed' ||
      tool.runId !== artifact.runId ||
      tool.artifacts?.some(
        (entry) => entry.id === artifact.id && JSON.stringify(entry) === JSON.stringify(artifact),
      ) !== true
    )
      throw new StorageError(
        'INVALID_RECORD',
        'Artifact metadata does not match its completed tool',
      );
    return artifact;
  }

  public list(sessionId: string): Artifact[] {
    return this.db
      .select({ id: schema.artifacts.id })
      .from(schema.artifacts)
      .where(eq(schema.artifacts.sessionId, sessionId))
      .all()
      .flatMap(({ id }) => {
        const artifact = this.get(sessionId, id);
        return artifact === undefined ? [] : [artifact];
      });
  }

  /** Archive and branch changes keep references; only uncommitted or explicitly unreferenced blobs are reclaimed. */
  public collectUnreferenced(): number {
    const referenced = new Set(
      this.db
        .select({ hash: schema.artifacts.sha256 })
        .from(schema.artifacts)
        .all()
        .map(({ hash }) => hash),
    );
    return this.artifactBlobs.collectUnreferenced(referenced);
  }

  /** All referenced bytes must exist before the owner stages any publication event. */
  public validatePublications(inputs: readonly EventInput[]): void {
    for (const input of inputs)
      if (input.type === 'artifact.published')
        this.artifactBlobs.read(checked(ArtifactPublishedSchema, input.data).artifact);
  }

  /** Journal commit makes the publication's temporary byte references durable. */
  public committed(events: readonly HarnessEvent[]): void {
    this.artifactBlobs.committed(
      events
        .filter((event) => event.type === 'artifact.published')
        .map((event) => checked(ArtifactSchema, event.data.artifact).sha256),
    );
  }
}
