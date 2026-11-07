import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { Value } from 'typebox/value';
import {
  AgentSettingsSchema,
  type AgentSettings,
  type AgentSettingsInput,
} from '@my-pi-harness/protocol';
import { StorageError } from '../shared/errors';
import { checked } from '../shared/validation';
import * as schema from '../sqlite/schema';

/** Independent user configuration; session projection rebuild never clears agent preferences. */
export class AgentSettingsRepository {
  public constructor(
    private readonly db: BetterSQLite3Database<typeof schema>,
    private readonly defaultSettings?: () => AgentSettings,
  ) {}

  public get(): AgentSettings {
    const stored = this.readStored();
    if (stored === undefined) {
      if (this.defaultSettings === undefined)
        throw new StorageError(
          'AGENT_SETTINGS_UNAVAILABLE',
          'Agent settings defaults were not configured by the application',
        );
      return this.defaultSettings();
    }
    return stored;
  }

  public put(input: AgentSettingsInput): AgentSettings {
    const settings = checked(AgentSettingsSchema, input);
    const issue = this.issue(settings);
    if (issue) throw new StorageError('AGENT_SETTINGS_INVALID', issue);
    const currentRevision = this.readStored()?.revision ?? 0;
    if (input.revision !== currentRevision)
      throw new StorageError('CONFLICT', 'Agent settings were changed by another client');
    const next = { ...settings, revision: currentRevision + 1 };
    this.db
      .insert(schema.agentSettings)
      .values({ id: 1, revision: next.revision, data: next })
      .onConflictDoUpdate({
        target: schema.agentSettings.id,
        set: { revision: next.revision, data: next },
      })
      .run();
    return next;
  }

  private readStored(): AgentSettings | undefined {
    const row = this.db
      .select()
      .from(schema.agentSettings)
      .where(eq(schema.agentSettings.id, 1))
      .get();
    if (row === undefined) return undefined;
    const settings = checked(AgentSettingsSchema, Value.Clean(AgentSettingsSchema, row.data));
    if (row.revision !== settings.revision)
      throw new StorageError('INVALID_RECORD', 'Agent settings revision is inconsistent');
    const issue = this.issue(settings);
    if (issue) throw new StorageError('INVALID_RECORD', issue);
    return settings;
  }

  private issue(settings: AgentSettings): string | undefined {
    if (new Set(settings.roles.map((role) => role.id)).size !== settings.roles.length)
      return '角色 ID 不能重复。';
    if (settings.roles.some((role) => (role.providerId === null) !== (role.modelId === null)))
      return '角色的 Provider 与模型必须同时选择。';
    return undefined;
  }
}
