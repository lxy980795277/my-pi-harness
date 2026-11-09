import { RuntimeError } from '@my-pi-harness/agent-runtime';
import type { CredentialStore } from '@my-pi-harness/storage';

/** Attempts every obsolete reference after configuration commits; failures never expose secret data. */
export async function deleteMcpCredentials(
  credentials: Pick<CredentialStore, 'delete'>,
  references: readonly (string | null)[],
): Promise<void> {
  const refs = new Set(references.filter((ref): ref is string => ref !== null));
  const results = await Promise.allSettled(
    [...refs].map(async (ref) => await credentials.delete(ref)),
  );
  if (results.some((result) => result.status === 'rejected'))
    throw new RuntimeError('MCP_CREDENTIAL_CLEANUP_FAILED', '配置已保存，但旧系统凭据清理失败。');
}
