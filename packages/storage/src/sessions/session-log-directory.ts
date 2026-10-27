import { createHash } from 'node:crypto';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { StorageError } from '../shared/errors.js';

/** Optional log placement never relocates the SQLite profile or its credentials. */
export interface ProfileStoreOptions {
  sessionLogRoot?: string;
}

/**
 * Resolve one profile's JSONL namespace without reading or creating files.
 * @param profileDirectory Canonical absolute profile path obtained with realpath by its owner.
 * @param sessionLogRoot Absolute log root whose final component is .my-pi-harness.
 * @returns The profile-isolated directory containing its session JSONL files.
 */
export function sessionLogDirectory(profileDirectory: string, sessionLogRoot: string): string {
  if (
    !isAbsolute(profileDirectory) ||
    !isAbsolute(sessionLogRoot) ||
    basename(resolve(sessionLogRoot)) !== '.my-pi-harness'
  )
    throw new StorageError(
      'INVALID_RECORD',
      'Session log root must be an absolute .my-pi-harness directory',
    );
  const profile = resolve(profileDirectory);
  const root = resolve(sessionLogRoot);
  const difference = relative(root, profile);
  if (
    difference === '' ||
    (!isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${sep}`))
  )
    throw new StorageError(
      'INVALID_RECORD',
      'The SQLite profile cannot be inside the session log root',
    );
  return join(root, 'sessions', createHash('sha256').update(profile).digest('hex'));
}
