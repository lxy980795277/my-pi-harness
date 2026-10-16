export { ProfileStore, openProfileStore } from './store.js';
export { StorageError, type StorageErrorCode } from './errors.js';
export { ProfileLockedError, acquireProfileLock, type ProfileLock } from './profile-lock.js';
export { SCHEMA_VERSION } from './migrations.js';
export {
  createCredentialStore,
  createSystemCredentialStore,
  createMemoryCredentialStore,
} from './credentials.js';
export type { CredentialStore, CredentialBackend, SecretUpdate } from './credentials.js';
export type { CreateSessionInput, EventInput, RequestAcceptance } from './types.js';

export { sessionLogDirectory, type ProfileStoreOptions } from './session-log-directory.js';
export { SessionBatchSchema, type SessionBatch } from './session-jsonl.js';
