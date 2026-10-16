import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  readdirSync,
  type Stats,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { StorageError } from './errors.js';
import { sessionLogDirectory } from './session-log-directory.js';

interface OwnedDirectory {
  path: string;
  identity: Stats;
  fd: number | undefined;
}
function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
function requireOwner(entry: Stats): void {
  if (process.getuid && entry.uid !== process.getuid())
    throw new StorageError('SESSION_LOG_INVALID', 'Session data must belong to the current user');
}

/** Owns checked, private directories for one profile's journals and immutable attachments. */
export class PrivateSessionFiles {
  public readonly directory: string;
  public readonly attachmentDirectory: string;
  private readonly directories: OwnedDirectory[] = [];
  private closed = false;

  public constructor(
    profileDirectory: string,
    sessionLogRoot = join(profileDirectory, '.my-pi-harness'),
  ) {
    sessionLogDirectory(profileDirectory, sessionLogRoot);
    const requestedRoot = resolve(sessionLogRoot);
    const parent = dirname(requestedRoot);
    if (lstatSync(parent).isSymbolicLink())
      throw new StorageError(
        'SESSION_LOG_INVALID',
        'Session log parent must not be a symbolic link',
      );
    const canonicalParent = realpathSync(parent);
    const root = join(canonicalParent, basename(requestedRoot));
    this.directory = sessionLogDirectory(profileDirectory, root);
    this.attachmentDirectory = join(this.directory, 'attachments');
    try {
      this.holdDirectory(profileDirectory);
      this.holdDirectory(canonicalParent);
      for (const path of [root, join(root, 'sessions'), this.directory, this.attachmentDirectory]) {
        this.checkDirectories();
        try {
          mkdirSync(path, { mode: 0o700 });
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
        }
        this.holdDirectory(path, true);
      }
      for (const directory of this.directories)
        if (directory.fd !== undefined) fsyncSync(directory.fd);
    } catch (error) {
      try {
        this.close();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Session data setup and cleanup failed');
      }
      throw error;
    }
  }

  public validateId(id: string): void {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(id))
      throw new StorageError(
        'INVALID_RECORD',
        'Session or attachment ID cannot be used as a private filename',
      );
  }

  private holdDirectory(path: string, privateDirectory = false): void {
    if (this.directories.some((entry) => entry.path === path)) return;
    const identity = lstatSync(path);
    if (!identity.isDirectory() || identity.isSymbolicLink() || realpathSync(path) !== path)
      throw new StorageError('SESSION_LOG_INVALID', 'Session data paths must be real directories');
    requireOwner(identity);
    const fd =
      process.platform === 'win32'
        ? undefined
        : openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    this.directories.push({ path, identity, fd });
    this.checkDirectories();
    if (privateDirectory && fd !== undefined) fchmodSync(fd, 0o700);
  }

  public checkDirectories(): void {
    if (this.closed) throw new StorageError('STORAGE_CLOSED', 'Session data is closed');
    for (const directory of this.directories) {
      const current = lstatSync(directory.path);
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        !sameFile(current, directory.identity) ||
        (directory.fd !== undefined && !sameFile(current, fstatSync(directory.fd))) ||
        realpathSync(directory.path) !== directory.path
      )
        throw new StorageError('SESSION_LOG_INVALID', 'Session data directory identity changed');
      requireOwner(current);
    }
  }

  public checkFile(fd: number, path: string): Stats {
    this.checkDirectories();
    const opened = fstatSync(fd);
    const current = lstatSync(path);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      current.isSymbolicLink() ||
      !sameFile(opened, current)
    )
      throw new StorageError(
        'SESSION_LOG_INVALID',
        'Session data must be regular files without links',
      );
    requireOwner(opened);
    return opened;
  }

  public names(directory: string): string[] {
    this.checkDirectories();
    return readdirSync(directory).sort();
  }

  public syncDirectory(path: string): void {
    this.checkDirectories();
    const directory = this.directories.find((entry) => entry.path === path);
    if (directory?.fd !== undefined) fsyncSync(directory.fd);
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    const failures: unknown[] = [];
    for (const directory of [...this.directories].reverse()) {
      if (directory.fd === undefined) continue;
      try {
        closeSync(directory.fd);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Session data directory cleanup failed');
  }
}
