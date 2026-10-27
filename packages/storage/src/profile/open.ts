import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { ProfileStore } from './store.js';
import { applyMigrations } from '../sqlite/migrations/apply.js';
import { acquireProfileLock } from './profile-lock.js';
import {
  sessionLogDirectory,
  type ProfileStoreOptions,
} from '../sessions/session-log-directory.js';

/**
 * Open one profile, migrate and interrupt old runs before any model work can begin.
 * @param directory Local application profile, separate from Pi or other harness data.
 * @param options Explicit log root; omission uses a hidden directory inside this profile.
 * @returns An owned synchronous store with its cross-process lock held until close.
 */
export async function openProfileStore(
  directory: string,
  options: ProfileStoreOptions = {},
): Promise<ProfileStore> {
  if (options.sessionLogRoot !== undefined)
    sessionLogDirectory(resolve(directory), options.sessionLogRoot);
  const lock = await acquireProfileLock(directory);
  let database: Database.Database | undefined;
  let store: ProfileStore | undefined;
  try {
    database = new Database(join(lock.directory, 'data.sqlite'), { timeout: 1000 });
    database.pragma('foreign_keys = ON');
    applyMigrations(database);
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = FULL');
    store = new ProfileStore(database, lock, options);
    store.recoverInterrupted();
    return store;
  } catch (error: unknown) {
    if (store) {
      try {
        store.close();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Profile recovery failed and storage cleanup also failed',
        );
      }
    } else {
      try {
        database?.close();
      } finally {
        lock.release();
      }
    }
    throw error;
  }
}
