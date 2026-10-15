/** Storage-owned failures that callers map to their transport without exposing SQL. */
export type StorageErrorCode =
  | 'PROFILE_LOCKED'
  | 'STORAGE_CLOSED'
  | 'DATABASE_INVALID'
  | 'MIGRATION_VERSION'
  | 'MIGRATION_CHANGED'
  | 'SESSION_NOT_FOUND'
  | 'RUN_NOT_FOUND'
  | 'PROVIDER_NOT_FOUND'
  | 'WORKSPACE_NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_EVENT'
  | 'INVALID_RECORD';

/** A storage failure with a safe, transport-independent code. */
export class StorageError extends Error {
  public constructor(
    public readonly code: StorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'StorageError';
  }
}
