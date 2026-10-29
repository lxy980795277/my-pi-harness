import { describe, expect, it } from 'vitest';
import { sessionProjection, projectionMessage } from '../../../tests/fixtures/session-projection';
import { conversationMessages } from '../src/features/sessions/utils/conversation-view';
import { countConversationTurns } from '../src/features/work/utils/work-view';

describe('human conversation projection', () => {
  it('keeps internal agent input in the source snapshot without displaying or counting a new human turn', () => {
    const source = sessionProjection();
    source.messages.push({
      ...projectionMessage(source, 'user'),
      id: 'internal',
      agentMessageId: 'communication',
      text: 'A child task report',
    });
    const visible = conversationMessages(source.messages);
    expect(visible.map((message) => message.id)).toEqual(['user', 'assistant']);
    expect(source.messages).toHaveLength(3);
    expect(countConversationTurns(visible)).toBe(1);
  });

  it('retains normal message array identity for the memoized timeline', () => {
    const snapshot = sessionProjection();
    expect(conversationMessages(snapshot.messages)).toBe(snapshot.messages);
  });
});
