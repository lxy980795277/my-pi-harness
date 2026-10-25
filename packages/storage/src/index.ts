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
export { SessionBatchSchema, type SessionBatch, type SessionLogDownload } from './session-jsonl.js';

export { AuthRepository } from './auth.js';
export type {
  VerifiedIdentity,
  LocalClient,
  LoginSessionInput,
  StoredLoginSession,
} from './auth-types.js';

export { McpRepository } from './mcp.js';
export type { StoredMcpServer, McpSecretBinding, McpStartupGrant, McpIdentity } from './mcp.js';
export { ExtensionRepository, type StoredSkill, type StoredPlugin } from './extensions.js';
export { RemoteMcpRepository, type StoredRemoteMcpServer } from './remote-mcp.js';
export { McpDirectoryRepository, type McpReadOnlyGrant } from './mcp-directory.js';

export { ConnectionRepository, type StoredConnection } from './connections.js';
