import { createHash } from 'node:crypto';
import type { MemoryScope, MemorySource } from '@my-pi-harness/protocol';
import { MemoryError } from './errors';

export function normalizeBody(value: string): string {
  const body = value.replace(/\r\n?/g, '\n').trim();
  if (!body || body.length > 16_000)
    throw new MemoryError(
      'MEMORY_INVALID',
      'Memory text must contain between 1 and 16000 characters',
    );
  return body;
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function canonicalScope(scope: MemoryScope): MemoryScope {
  return scope.kind === 'user'
    ? { kind: 'user' }
    : { kind: 'workspace', workspaceId: scope.workspaceId };
}

export function canonicalSource(source?: MemorySource): MemorySource {
  return source?.kind !== 'message'
    ? { kind: 'manual' }
    : {
        kind: 'message',
        sessionId: source.sessionId,
        branchId: source.branchId,
        messageId: source.messageId,
        contentHash: source.contentHash,
      };
}
