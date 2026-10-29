/** Storage-owned failures that callers map to their transport without exposing SQL. */
export type StorageErrorCode =
  | 'PROFILE_LOCKED'
  | 'STORAGE_CLOSED'
  | 'LOCAL_CLIENT_EXPIRED'
  | 'PROFILE_ACCOUNT_MISMATCH'
  | 'DATABASE_INVALID'
  | 'MIGRATION_VERSION'
  | 'MIGRATION_CHANGED'
  | 'SESSION_NOT_FOUND'
  | 'RUN_NOT_FOUND'
  | 'PROVIDER_NOT_FOUND'
  | 'WORKSPACE_NOT_FOUND'
  | 'AGENT_SETTINGS_INVALID'
  | 'CONFLICT'
  | 'INVALID_EVENT'
  | 'INVALID_RECORD'
  | 'SESSION_LOG_INVALID'
  | 'SESSION_LOG_UNAVAILABLE';

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
