import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { StorageError } from '../shared/errors.js';

/** Owns a separate SQLite rollback-mode exclusive transaction for the daemon lifetime. */
export interface ProfileLock {
  directory: string;
  release(): void;
}

/** The OS lock is already held by another daemon; no stale-time heuristic is used. */
export class ProfileLockedError extends StorageError {
  public constructor() {
    super('PROFILE_LOCKED', 'This profile is already owned by another daemon');
    this.name = 'ProfileLockedError';
  }
}

/**
 * Acquire cross-process SQLite VFS locks before migrations or recovery.
 * The lock database is retained: unlinking it could let another process lock a new inode.
 * @param directory Local profile directory, canonicalized before opening lock resources.
 * @returns A lock released by close or by the operating system after process death.
 */
export async function acquireProfileLock(directory: string): Promise<ProfileLock> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const canonical = await realpath(directory);
  const database = new Database(join(canonical, 'owner.sqlite'), { timeout: 0 });
  try {
    database.pragma('journal_mode = DELETE');
    database.exec('BEGIN EXCLUSIVE');
  } catch (error: unknown) {
    database.close();
    if (error instanceof Error && 'code' in error && error.code === 'SQLITE_BUSY') {
      throw new ProfileLockedError();
    }
    throw error;
  }
  let released = false;
  return {
    directory: canonical,
    release(): void {
      if (released) return;
      released = true;
      database.close();
    },
  };
}
