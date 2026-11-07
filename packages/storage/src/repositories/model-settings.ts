import { asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  AppSettingsSchema,
  type AppSettings,
  type AppSettingsInput,
} from '@my-pi-harness/protocol';
import { ProviderRecordSchema, type ProviderRecord } from '@my-pi-harness/protocol/internal';
import { StorageError } from '../shared/errors';
import { checked } from '../shared/validation';
import * as schema from '../sqlite/schema';

/** Model configuration and defaults; the profile owns transactions and the write-failure gate. */
export class ModelSettingsRepository {
  public constructor(
    private readonly db: BetterSQLite3Database<typeof schema>,
    private readonly assertOpen: () => void,
    private readonly transact: <T>(operation: () => T) => T,
  ) {}

  /** Host records include opaque credential references; the gateway projects public metadata. */
  public listProviders(): ProviderRecord[] {
    this.assertOpen();
    return this.db
      .select()
      .from(schema.providers)
      .orderBy(asc(schema.providers.id))
      .all()
      .map((row) => checked(ProviderRecordSchema, row.data));
  }

  /** Read one provider configuration without retrieving secrets. */
  public getProvider(id: string): ProviderRecord | undefined {
    this.assertOpen();
    const row = this.db.select().from(schema.providers).where(eq(schema.providers.id, id)).get();
    return row ? checked(ProviderRecordSchema, row.data) : undefined;
  }

  /** Save a caller-incremented revision; computed credential flags are never durable facts. */
  public putProvider(input: ProviderRecord, expectedRevision?: number): ProviderRecord {
    const value = checked(ProviderRecordSchema, {
      ...input,
      hasCredential: false,
      credentialType: null,
      legacy: false,
      configured: false,
      authSource: null,
      credentialPreview: null,
    });
    return this.transact(() => {
      const current = this.getProvider(value.id);
      if (
        (expectedRevision !== undefined && current?.revision !== expectedRevision) ||
        value.revision !== (current?.revision ?? 0) + 1
      ) {
        throw new StorageError('CONFLICT', 'Provider configuration revision has changed');
      }
      this.db
        .insert(schema.providerVersions)
        .values({ id: value.id, revision: value.revision, data: value })
        .run();
      this.db
        .insert(schema.providers)
        .values({ id: value.id, revision: value.revision, data: value })
        .onConflictDoUpdate({
          target: schema.providers.id,
          set: { revision: value.revision, data: value },
        })
        .run();
      return value;
    });
  }

  /** Resolve the stable normal entry without changing historical provider identities. */
  public getBuiltinProviderId(builtinId: string): string | undefined {
    this.assertOpen();
    return this.db
      .select()
      .from(schema.builtinSlots)
      .where(eq(schema.builtinSlots.builtinId, builtinId))
      .get()?.providerId;
  }

  /** Bind a newly seeded native entry once; an existing binding cannot be replaced. */
  public bindBuiltinProvider(builtinId: string, providerId: string): void {
    this.transact(() => {
      const current = this.getBuiltinProviderId(builtinId);
      if (current === providerId) return;
      if (current !== undefined)
        throw new StorageError('CONFLICT', 'Native provider entry already exists');
      const provider = this.getProvider(providerId);
      if (
        provider?.kind !== 'builtin' ||
        provider.builtinId !== builtinId ||
        provider.baseUrl !== null ||
        provider.models.length !== 0
      )
        throw new StorageError(
          'INVALID_RECORD',
          'Native entry requires unmodified factory metadata',
        );
      this.db.insert(schema.builtinSlots).values({ builtinId, providerId }).run();
    });
  }

  /** Defaults apply to future sessions, independently from existing session projections. */
  public getSettings(): AppSettings {
    this.assertOpen();
    return checked(
      AppSettingsSchema,
      this.db.select().from(schema.appSettings).where(eq(schema.appSettings.id, 1)).get()?.data,
    );
  }

  /** Persist one optimistic settings revision without changing sessions or model history. */
  public putSettings(input: AppSettingsInput): AppSettings {
    return this.transact(() => {
      const previous = this.getSettings();
      if (previous.revision !== input.expectedRevision)
        throw new StorageError('CONFLICT', 'Application settings revision has changed');
      const value = checked(AppSettingsSchema, {
        revision: previous.revision + 1,
        defaultModel: input.defaultModel,
      });
      this.db
        .update(schema.appSettings)
        .set({ revision: value.revision, data: value })
        .where(eq(schema.appSettings.id, 1))
        .run();
      return value;
    });
  }

  /** Remove current settings without rewriting sessions or accepted run history. */
  public deleteProvider(id: string): void {
    this.transact(() => {
      this.db.delete(schema.providers).where(eq(schema.providers.id, id)).run();
    });
  }
}
