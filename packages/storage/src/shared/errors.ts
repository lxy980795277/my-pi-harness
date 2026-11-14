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
  | 'ARCHIVE_INVALID'
  | 'ARCHIVE_CONFLICT'
  | 'ARCHIVE_NOT_FOUND'
  | 'SESSION_BINDING_REQUIRED'
  | 'FILE_CHANGE_OPERATION_CONFLICT'
  | 'FILE_CHANGE_NOT_FOUND'
  | 'FILE_OPERATION_NOT_FOUND'
  | 'FILE_CHANGE_QUERY_INVALID'
  | 'TRACE_NOT_FOUND'
  | 'TRACE_QUERY_INVALID'
  | 'PROVIDER_NOT_FOUND'
  | 'WORKSPACE_NOT_FOUND'
  | 'MEMORY_NOT_FOUND'
  | 'AGENT_SETTINGS_INVALID'
  | 'AGENT_SETTINGS_UNAVAILABLE'
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
