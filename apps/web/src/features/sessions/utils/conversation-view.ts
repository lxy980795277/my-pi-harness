import type { MessageView } from '@my-pi-harness/protocol';

/** Internal agent inputs remain in the query/history but never become human conversation turns. */
export const conversationMessages = (source: MessageView[]): MessageView[] => {
  const messages = source.filter((message) => {
    return message.agentMessageId === undefined;
  });
  if (messages.length === source.length) return source;
  return messages;
};
