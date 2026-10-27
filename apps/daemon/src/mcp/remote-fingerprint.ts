import { createHash } from 'node:crypto';
import type { StoredRemoteMcpServer } from '@my-pi-harness/storage';

/** Canonical metadata and credential digests distinguish protocol leases without retaining raw secrets. */
export function remoteFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(
      JSON.stringify(value, (_key, entry: unknown) =>
        entry !== null && typeof entry === 'object' && !Array.isArray(entry)
          ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
          : entry,
      ),
    )
    .digest('hex');
}

/** Stable model tool names reveal neither a provider's raw tool name nor the server identifier. */
export function remoteToolAlias(id: string, name: string): string {
  return `mcp_${remoteFingerprint(id).slice(0, 16)}_${remoteFingerprint(name).slice(0, 32)}`;
}

/** Startup trust binds the declared endpoint and authentication configuration, excluding token bytes. */
export function remoteStartupFingerprint(server: StoredRemoteMcpServer): string {
  return remoteFingerprint({
    endpoint: server.endpoint,
    transport: server.transport,
    publicHeaders: server.publicHeaders,
    secretHeaders: server.secretHeaders,
    oauth: server.oauth,
    oauthClient: server.oauthClient,
    connectionId: server.connectionId,
  });
}
