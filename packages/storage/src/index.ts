export { ProfileStore } from './profile/store.js';
export { openProfileStore } from './profile/open.js';
export { StorageError, type StorageErrorCode } from './shared/errors.js';
export {
  ProfileLockedError,
  acquireProfileLock,
  type ProfileLock,
} from './profile/profile-lock.js';
export { SCHEMA_VERSION } from './sqlite/migrations/apply.js';
export {
  createCredentialStore,
  createSystemCredentialStore,
  createMemoryCredentialStore,
} from './credentials/credentials.js';
export type {
  CredentialStore,
  CredentialBackend,
  SecretUpdate,
} from './credentials/credentials.js';
export type { CreateSessionInput, EventInput, RequestAcceptance } from './sessions/types.js';

export { sessionLogDirectory, type ProfileStoreOptions } from './sessions/session-log-directory.js';
export {
  SessionBatchSchema,
  type SessionBatch,
  type SessionLogDownload,
} from './sessions/session-jsonl.js';

export { AuthRepository } from './repositories/auth.js';
export type {
  VerifiedIdentity,
  LocalClient,
  LoginSessionInput,
  StoredLoginSession,
} from './repositories/auth-types.js';

export { McpRepository } from './repositories/mcp.js';
export type {
  StoredMcpServer,
  McpSecretBinding,
  McpStartupGrant,
  McpIdentity,
} from './repositories/mcp.js';
export {
  ExtensionRepository,
  type StoredSkill,
  type StoredPlugin,
} from './repositories/extensions.js';
export { RemoteMcpRepository, type StoredRemoteMcpServer } from './repositories/remote-mcp.js';
export {
  McpDirectoryRepository,
  type McpReadOnlyGrant,
  type StoredMcpCatalog,
} from './repositories/mcp-directory.js';

export { ConnectionRepository, type StoredConnection } from './repositories/connections.js';
export {
  PluginCredentialStore,
  type PluginOAuthCredential,
} from './credentials/plugin-credentials.js';
