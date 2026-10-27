import { and, asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  WorkspaceSchema,
  type Workspace,
  type WorkspaceRenameInput,
} from '@my-pi-harness/protocol';
import { StorageError } from '../shared/errors.js';
import * as schema from '../sqlite/schema.js';
import { checked } from '../shared/validation.js';

/** Workspace rows share the profile owner's transactions and never touch local files. */
export class WorkspaceRepository {
  public constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

  private value(row: typeof schema.workspaces.$inferSelect): Workspace {
    const workspace = checked(WorkspaceSchema, row.data);
    if (workspace.id !== row.id || workspace.rootPath !== row.rootPath)
      throw new StorageError('INVALID_RECORD', 'Workspace identity or directory is inconsistent');
    return workspace;
  }

  public list(): Workspace[] {
    return this.db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.archived, false))
      .orderBy(asc(schema.workspaces.id))
      .all()
      .map((row) => this.value(row))
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  }

  public get(id: string): Workspace | undefined {
    const row = this.db
      .select()
      .from(schema.workspaces)
      .where(and(eq(schema.workspaces.id, id), eq(schema.workspaces.archived, false)))
      .get();
    return row ? this.value(row) : undefined;
  }

  public create(input: Workspace): Workspace {
    const value = checked(WorkspaceSchema, input);
    if (value.revision !== 1)
      throw new StorageError('INVALID_RECORD', 'New workspace revision must be one');
    this.db
      .insert(schema.workspaces)
      .values({ id: value.id, rootPath: value.rootPath, data: value, archived: false })
      .run();
    return value;
  }

  public rename(id: string, input: WorkspaceRenameInput, at: number): Workspace {
    const previous = this.get(id);
    if (!previous) throw new StorageError('WORKSPACE_NOT_FOUND', 'Workspace does not exist');
    if (input.expectedRevision !== previous.revision)
      throw new StorageError('CONFLICT', 'Workspace revision has changed');
    const value = checked(WorkspaceSchema, {
      ...previous,
      name: input.name,
      icon: input.icon ?? previous.icon,
      revision: previous.revision + 1,
      updatedAt: at,
    });
    this.db
      .update(schema.workspaces)
      .set({ data: value })
      .where(eq(schema.workspaces.id, id))
      .run();
    return value;
  }

  public archive(id: string): void {
    if (!this.get(id)) throw new StorageError('WORKSPACE_NOT_FOUND', 'Workspace does not exist');
    const session = this.db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.workspaceId, id), eq(schema.sessions.archived, false)))
      .limit(1)
      .get();
    if (session)
      throw new StorageError('CONFLICT', 'Archive the workspace sessions before removing it');
    this.db
      .update(schema.workspaces)
      .set({ archived: true })
      .where(eq(schema.workspaces.id, id))
      .run();
  }
}
