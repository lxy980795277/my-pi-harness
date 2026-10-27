import type Database from 'better-sqlite3';
import { Type, type Static, type TSchema } from 'typebox';
import { SkillScopeSchema, PluginComponentSchema } from '@my-pi-harness/protocol';
import { StorageError } from '../shared/errors.js';
import { checked } from '../shared/validation.js';

export type StoredSkill = Static<typeof SkillRecordSchema>;
export type StoredPlugin = Static<typeof PluginRecordSchema>;

const object = { additionalProperties: false } as const;
const id = Type.String({ minLength: 1, maxLength: 160 });

const SkillRecordSchema = Type.Object(
  {
    id,
    revision: Type.Integer({ minimum: 1 }),
    enabled: Type.Boolean(),
    managed: Type.Boolean(),
    directory: Type.String(),
    scope: SkillScopeSchema,
    pluginId: Type.Union([id, Type.Null()]),
    workspaceId: Type.Union([id, Type.Null()]),
    source: Type.String(),
    contentHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  },
  object,
);

const PluginRecordSchema = Type.Object(
  {
    generation: Type.String({ minLength: 1, maxLength: 160 }),
    id,
    revision: Type.Integer({ minimum: 1 }),
    enabled: Type.Boolean(),
    directory: Type.String(),
    components: Type.Array(PluginComponentSchema),
  },
  object,
);

const RowSchema = Type.Object({ id, revision: Type.Integer({ minimum: 1 }), data: Type.String() });

/** Installation facts and controls contain no executable code or credential bytes. */
export class ExtensionRepository {
  public constructor(
    private readonly sqlite: Database.Database,
    private readonly assertOpen: () => void,
  ) {}
  private rows<T extends TSchema>(kind: string, schema: T): Static<T>[] {
    this.assertOpen();
    return this.sqlite
      .prepare('SELECT id, revision, data FROM extension_records WHERE kind = ? ORDER BY id')
      .all(kind)
      .map((row) => {
        const stored = checked(RowSchema, row);
        let value: unknown;
        try {
          value = JSON.parse(stored.data);
        } catch (cause) {
          throw new StorageError('INVALID_RECORD', 'Invalid extension JSON', { cause });
        }
        const decoded = checked(schema, value);
        if (
          !('id' in decoded) ||
          decoded.id !== stored.id ||
          !('revision' in decoded) ||
          decoded.revision !== stored.revision
        )
          throw new StorageError('INVALID_RECORD', 'Extension identity is inconsistent');
        return decoded;
      });
  }
  public skills(): StoredSkill[] {
    return this.rows('skill', SkillRecordSchema);
  }
  public plugins(): StoredPlugin[] {
    return this.rows('plugin', PluginRecordSchema);
  }
  private save(
    kind: string,
    input: StoredSkill | StoredPlugin,
    expectedRevision: number | null,
  ): void {
    this.assertOpen();
    this.sqlite
      .transaction(() => {
        const previous = this.sqlite
          .prepare('SELECT revision FROM extension_records WHERE kind = ? AND id = ?')
          .get(kind, input.id);
        if (expectedRevision === null) {
          if (previous !== undefined || input.revision !== 1)
            throw new StorageError('CONFLICT', 'Extension already exists');
        } else {
          const row = checked(Type.Object({ revision: Type.Integer() }), previous);
          if (row.revision !== expectedRevision || input.revision !== expectedRevision + 1)
            throw new StorageError('CONFLICT', 'Extension revision changed');
        }
        this.sqlite
          .prepare(
            'INSERT INTO extension_records(kind,id,revision,data) VALUES (?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,data=excluded.data',
          )
          .run(kind, input.id, input.revision, JSON.stringify(input));
      })
      .immediate();
  }
  public saveSkill(input: StoredSkill, expectedRevision: number | null): StoredSkill {
    const value = checked(SkillRecordSchema, input);
    this.save('skill', value, expectedRevision);
    return value;
  }
  public savePlugin(input: StoredPlugin, expectedRevision: number | null): StoredPlugin {
    const value = checked(PluginRecordSchema, input);
    this.save('plugin', value, expectedRevision);
    return value;
  }
  private remove(kind: string, id: string, expectedRevision: number): void {
    this.assertOpen();
    const result = this.sqlite
      .prepare('DELETE FROM extension_records WHERE kind = ? AND id = ? AND revision = ?')
      .run(kind, id, expectedRevision);
    if (result.changes !== 1) throw new StorageError('CONFLICT', 'Extension revision changed');
  }
  public removeSkill(id: string, expectedRevision: number): void {
    this.remove('skill', id, expectedRevision);
  }
  public removePlugin(id: string, expectedRevision: number): void {
    this.remove('plugin', id, expectedRevision);
  }
}
