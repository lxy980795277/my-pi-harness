import type { Message } from '@earendil-works/pi-ai';

/** Omit incomplete tool cycles after an interrupted run; never synthesize a successful result. */
export function completeToolHistory(messages: readonly Message[]): Message[] {
  const result: Message[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === 'toolResult') continue;
    if (message.role !== 'assistant') {
      result.push(message);
      continue;
    }
    const calls = message.content.filter((part) => part.type === 'toolCall');
    if (calls.length === 0) {
      result.push(message);
      continue;
    }
    const following: Message[] = [];
    let next = index + 1;
    while (messages[next]?.role === 'toolResult') {
      const entry = messages[next];
      if (entry) following.push(entry);
      next += 1;
    }
    const paired = calls.every(
      (call) =>
        following.filter(
          (entry) =>
            entry.role === 'toolResult' &&
            entry.toolCallId === call.id &&
            entry.toolName === call.name,
        ).length === 1,
    );
    if (paired && following.length === calls.length) result.push(message, ...following);
    index = next - 1;
  }
  return result;
}
