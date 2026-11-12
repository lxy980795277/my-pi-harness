export { ProfileStore } from './profile/store';
export { MemoryRepository } from './memory/repository';
export { SearchRepository } from './search/repository';
export { openProfileStore } from './profile/open';
export { StorageError, type StorageErrorCode } from './shared/errors';
export { ProfileLockedError, acquireProfileLock, type ProfileLock } from './profile/profile-lock';
export { SCHEMA_VERSION } from './sqlite/migrations/apply';
export {
  createCredentialStore,
  createSystemCredentialStore,
  createMemoryCredentialStore,
} from './credentials/credentials';
export type { CredentialStore, CredentialBackend, SecretUpdate } from './credentials/credentials';
export type { ArtifactBlob, ArtifactDownload, ArtifactLimits } from './artifacts/blobs';

export { sessionLogDirectory } from './sessions/session-log-directory';
export type { ProfileStoreOptions } from './profile/options';
export {
  SessionBatchSchema,
  type SessionBatch,
  type SessionLogDownload,
} from './sessions/session-jsonl';

export { AuthRepository } from './repositories/auth';
export type {
  VerifiedIdentity,
  LocalClient,
  LoginSessionInput,
  StoredLoginSession,
} from './repositories/auth-types';

export { McpRepository } from './repositories/mcp';
export type {
  StoredMcpServer,
  McpSecretBinding,
  McpStartupGrant,
  McpIdentity,
} from './repositories/mcp';
export { ExtensionRepository, type StoredSkill } from './repositories/extensions';
export { RemoteMcpRepository, type StoredRemoteMcpServer } from './repositories/remote-mcp';
export {
  McpDirectoryRepository,
  type McpReadOnlyGrant,
  type StoredMcpCatalog,
} from './repositories/mcp-directory';

export { ConnectionRepository, type StoredConnection } from './repositories/connections';
export { PluginCredentialStore } from './credentials/plugin-credentials';
