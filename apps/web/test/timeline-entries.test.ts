import type { MessageView, ToolCallView } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import { buildTimelineEntries } from '../src/features/sessions/utils/timeline-entries';

const message = (id: string, role: MessageView['role'], createdAt: number): MessageView => {
  return {
    id,
    sessionId: 'session',
    branchId: 'branch',
    runId: 'run',
    role,
    text: id,
    thinking: '',
    createdAt,
    status: 'complete',
    stopReason: null,
  };
};

const tool = (id: string, afterMessageId: string, createdAt: number): ToolCallView => {
  return {
    id,
    afterMessageId,
    sessionId: 'session',
    branchId: 'branch',
    runId: 'run',
    name: 'read_file',
    arguments: { path: id },
    status: 'completed',
    summary: id,
    result: 'Read file',
    diff: null,
    createdAt,
    updatedAt: createdAt,
  };
};

describe('session timeline placement', () => {
  it('places every tool round after its assistant and before the final answer at the same millisecond', () => {
    const messages = [
      message('user', 'user', 10),
      message('first-round', 'assistant', 10),
      message('second-round', 'assistant', 10),
      message('answer', 'assistant', 10),
    ];
    const tools = [
      tool('second-id', 'first-round', 10),
      tool('first-id', 'first-round', 10),
      tool('third-id', 'second-round', 10),
    ];
    const entries = buildTimelineEntries(messages, tools);
    expect(
      entries.map((entry) => {
        return entry.id;
      }),
    ).toEqual([
      'message:user',
      'message:first-round',
      'tool:second-id',
      'tool:first-id',
      'message:second-round',
      'tool:third-id',
      'message:answer',
    ]);
    expect(messages[2]?.id).toBe('second-round');
    expect(tools[0]?.id).toBe('second-id');
  });

  it('keeps persisted message and tool request order when the clock moves backwards', () => {
    const entries = buildTimelineEntries(
      [
        message('user', 'user', 300),
        message('assistant', 'assistant', 200),
        message('answer', 'assistant', 100),
      ],
      [tool('first', 'assistant', 50), tool('second', 'assistant', 40)],
    );
    expect(
      entries.map((entry) => {
        return entry.id;
      }),
    ).toEqual(['message:user', 'message:assistant', 'tool:first', 'tool:second', 'message:answer']);
  });

  it('preserves the supplied message sequence when no tools exist', () => {
    const messages = [message('user', 'user', 20), message('answer', 'assistant', 10)];
    const entries = buildTimelineEntries(messages, []);
    expect(
      entries.map((entry) => {
        return entry.id;
      }),
    ).toEqual(['message:user', 'message:answer']);
    expect(entries[0]).toMatchObject({ type: 'message', message: messages[0] });
  });

  it('rejects an orphan tool instead of hiding committed activity', () => {
    expect(() => {
      buildTimelineEntries([message('user', 'user', 10)], [tool('orphan', 'missing', 10)]);
    }).toThrow('工具调用缺少对应消息');
  });
});
