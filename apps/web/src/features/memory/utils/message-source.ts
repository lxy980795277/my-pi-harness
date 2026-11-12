import type { MemorySource, MessageView } from '@my-pi-harness/protocol';

/** Hashes the complete persisted text, independently of any edited memory draft or visible excerpt. */
export const memoryMessageSource = async (
  message: MessageView,
  branchId: string,
): Promise<Extract<MemorySource, { kind: 'message' }>> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message.text));
  const contentHash = Array.from(new Uint8Array(digest), (value) => {
    return value.toString(16).padStart(2, '0');
  }).join('');
  return {
    kind: 'message',
    sessionId: message.sessionId,
    branchId,
    messageId: message.id,
    contentHash,
  };
};
