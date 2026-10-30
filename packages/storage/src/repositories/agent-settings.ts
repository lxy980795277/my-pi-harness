import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { Value } from 'typebox/value';
import {
  AgentSettingsSchema,
  defaultAgentSettings,
  type AgentSettings,
  type AgentSettingsInput,
} from '@my-pi-harness/protocol';
import { StorageError } from '../shared/errors.js';
import { checked } from '../shared/validation.js';
import * as schema from '../sqlite/schema.js';

/** Independent user configuration; session projection rebuild never clears agent preferences. */
export class AgentSettingsRepository {
  public constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

  public get(): AgentSettings {
    const row = this.db
      .select()
      .from(schema.agentSettings)
      .where(eq(schema.agentSettings.id, 1))
      .get();
    if (!row) return defaultAgentSettings();
    const settings = checked(AgentSettingsSchema, Value.Clean(AgentSettingsSchema, row.data));
    if (row.revision !== settings.revision)
      throw new StorageError('INVALID_RECORD', 'Agent settings revision is inconsistent');
    const issue = this.issue(settings);
    if (issue) throw new StorageError('INVALID_RECORD', issue);
    return settings;
  }

  public put(input: AgentSettingsInput): AgentSettings {
    const settings = checked(AgentSettingsSchema, input);
    const issue = this.issue(settings);
    if (issue) throw new StorageError('AGENT_SETTINGS_INVALID', issue);
    const current = this.get();
    if (input.revision !== current.revision)
      throw new StorageError('CONFLICT', 'Agent settings were changed by another client');
    const next = { ...settings, revision: current.revision + 1 };
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

  private issue(settings: AgentSettings): string | undefined {
    if (new Set(settings.roles.map((role) => role.id)).size !== settings.roles.length)
      return '角色 ID 不能重复。';
    if (settings.roles.some((role) => (role.providerId === null) !== (role.modelId === null)))
      return '角色的 Provider 与模型必须同时选择。';
    return undefined;
  }
}
