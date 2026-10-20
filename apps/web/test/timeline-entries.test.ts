import type { MessageView, RunView, ToolCallView } from '@my-pi-harness/protocol';
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

const run = (status: RunView['status'] = 'completed'): RunView => {
  let finishedAt: number | null = 40;
  if (status === 'running') finishedAt = null;
  return {
    id: 'run',
    sessionId: 'session',
    branchId: 'branch',
    providerId: 'provider',
    modelId: 'model',
    status,
    createdAt: 10,
    finishedAt,
    error: null,
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
    const entries = buildTimelineEntries(messages, tools, null);
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
      'answer:user',
    ]);
    expect(entries.at(-1)).toMatchObject({
      type: 'answer-footer',
      id: 'answer:user',
      footer: { inputId: 'user', copyText: 'first-round\n\nsecond-round\n\nanswer' },
    });
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
      null,
    );
    expect(
      entries.map((entry) => {
        return entry.id;
      }),
    ).toEqual([
      'message:user',
      'message:assistant',
      'tool:first',
      'tool:second',
      'message:answer',
      'answer:user',
    ]);
  });

  it('preserves the supplied message sequence when no tools exist', () => {
    const messages = [message('user', 'user', 20), message('answer', 'assistant', 10)];
    const entries = buildTimelineEntries(messages, [], null);
    expect(
      entries.map((entry) => {
        return entry.id;
      }),
    ).toEqual(['message:user', 'message:answer', 'answer:user']);
    expect(entries[0]).toMatchObject({ type: 'message', message: messages[0] });
  });

  it('places the only answer footer after the final tool when no final prose is produced', () => {
    const messages = [
      message('user', 'user', 10),
      { ...message('preamble', 'assistant', 20), text: '正在检查文件', stopReason: 'toolUse' },
    ];
    const tools = [tool('first', 'preamble', 20), tool('second', 'preamble', 25)];
    for (const status of ['completed', 'cancelled', 'failed', 'interrupted'] as const) {
      const entries = buildTimelineEntries(messages, tools, null, [run(status)], 'branch');
      expect(entries.map((entry) => entry.id)).toEqual([
        'message:user',
        'message:preamble',
        'tool:first',
        'tool:second',
        'answer:user',
      ]);
      expect(entries.at(-1)).toMatchObject({
        type: 'answer-footer',
        footer: { inputId: 'user', copyText: '正在检查文件' },
      });
      expect(entries.filter((entry) => entry.type === 'answer-footer')).toHaveLength(1);
    }
  });

  it('places the footer after tools belonging to a hidden empty trailing assistant', () => {
    const messages = [
      message('user', 'user', 10),
      { ...message('preamble', 'assistant', 20), text: '已有可见正文' },
      { ...message('empty-final', 'assistant', 30), text: '' },
    ];
    const entries = buildTimelineEntries(
      messages,
      [tool('read', 'empty-final', 30)],
      null,
      [run()],
      'branch',
    );
    expect(entries.map((entry) => entry.id)).toEqual([
      'message:user',
      'message:preamble',
      'tool:read',
      'answer:user',
    ]);
    expect(entries.at(-1)).toMatchObject({
      type: 'answer-footer',
      id: 'answer:user',
      footer: { inputId: 'user', copyText: '已有可见正文' },
    });
  });

  it('settles the earlier input before the next user in the same running run', () => {
    const messages = [
      message('first-user', 'user', 10),
      { ...message('first-answer', 'assistant', 20), text: '第一轮回答', finishedAt: 25 },
      message('queued-user', 'user', 30),
      {
        ...message('queued-answer', 'assistant', 35),
        text: '第二轮仍在生成',
        status: 'streaming' as const,
      },
    ];
    const entries = buildTimelineEntries(messages, [], 'run', [run('running')], 'branch');
    expect(entries.map((entry) => entry.id)).toEqual([
      'message:first-user',
      'message:first-answer',
      'answer:first-user',
      'message:queued-user',
      'message:queued-answer',
    ]);
    expect(entries[2]).toMatchObject({
      type: 'answer-footer',
      footer: { inputId: 'first-user', copyText: '第一轮回答' },
    });
  });

  it('does not put an answer footer between tool activity and the next streamed step', () => {
    const messages = [
      message('user', 'user', 10),
      { ...message('preamble', 'assistant', 20), stopReason: 'toolUse' },
    ];
    const tools = [{ ...tool('read', 'preamble', 20), status: 'running' as const }];
    const active = buildTimelineEntries(messages, tools, 'run', [run('running')], 'branch');
    expect(active.map((entry) => entry.id)).toEqual([
      'message:user',
      'message:preamble',
      'tool:read',
    ]);
    const next = buildTimelineEntries(
      [...messages, { ...message('answer', 'assistant', 30), status: 'streaming' }],
      [tool('read', 'preamble', 20)],
      'run',
      [run('running')],
      'branch',
    );
    expect(next.map((entry) => entry.id)).toEqual([
      'message:user',
      'message:preamble',
      'tool:read',
      'message:answer',
    ]);
  });

  it('rejects an orphan tool instead of hiding committed activity', () => {
    expect(() => {
      buildTimelineEntries([message('user', 'user', 10)], [tool('orphan', 'missing', 10)], null);
    }).toThrow('工具调用缺少对应消息');
  });

  it('omits empty completed assistant bubbles while retaining their tool position and active status', () => {
    const empty = { ...message('tool-round', 'assistant', 20), text: '' };
    const waiting = {
      ...message('waiting', 'assistant', 30),
      text: '',
      status: 'streaming' as const,
    };
    const entries = buildTimelineEntries(
      [message('user', 'user', 10), empty, waiting],
      [tool('read', 'tool-round', 20)],
      'run',
    );
    expect(
      entries.map((entry) => {
        return entry.id;
      }),
    ).toEqual(['message:user', 'tool:read', 'message:waiting']);
    expect(empty.text).toBe('');
  });

  it('shows a temporary waiting row before the accepted run has an assistant message', () => {
    const messages = [message('user', 'user', 10)];
    const entries = buildTimelineEntries(messages, [], 'run');
    expect(entries).toEqual([
      { type: 'message', id: 'message:user', createdAt: 10, message: messages[0] },
      { type: 'waiting', id: 'waiting:run', runId: 'run' },
    ]);
    expect(messages).toHaveLength(1);
  });

  it.each([
    { text: '', thinking: '' },
    { text: '', thinking: '推理内容' },
    { text: '开始回答', thinking: '' },
  ])('uses the streaming assistant instead of a second waiting row: %j', (content) => {
    const assistant: MessageView = {
      ...message('assistant', 'assistant', 20),
      ...content,
      status: 'streaming',
    };
    const entries = buildTimelineEntries([message('user', 'user', 10), assistant], [], 'run');
    expect(entries.map((entry) => entry.type)).toEqual(['message', 'message']);
  });

  it.each(['reviewing', 'awaiting_approval', 'running'] as const)(
    'keeps %s tool activity visible without a duplicate waiting row',
    (status) => {
      const assistant = { ...message('assistant', 'assistant', 20), text: '' };
      const activity = { ...tool('read', 'assistant', 20), status };
      const entries = buildTimelineEntries(
        [message('user', 'user', 10), assistant],
        [activity],
        'run',
      );
      expect(entries.map((entry) => entry.type)).toEqual(['message', 'tool']);
    },
  );

  it('resumes waiting after a tool completes, then removes it when the run settles', () => {
    const messages = [
      message('user', 'user', 10),
      { ...message('assistant', 'assistant', 20), text: '' },
    ];
    const tools = [tool('read', 'assistant', 20)];
    expect(buildTimelineEntries(messages, tools, 'run').map((entry) => entry.type)).toEqual([
      'message',
      'tool',
      'waiting',
    ]);
    expect(buildTimelineEntries(messages, tools, null).map((entry) => entry.type)).toEqual([
      'message',
      'tool',
    ]);
  });

  it('does not let another run suppress waiting or reuse its waiting row identity', () => {
    const messages: MessageView[] = [
      {
        ...message('previous', 'assistant', 10),
        status: 'streaming',
      },
      { ...message('user', 'user', 20), runId: 'next-run' },
    ];
    const tools = [{ ...tool('old-read', 'previous', 10), status: 'running' as const }];
    const entries = buildTimelineEntries(messages, tools, 'next-run');
    expect(entries.at(-1)).toEqual({
      type: 'waiting',
      id: 'waiting:next-run',
      runId: 'next-run',
    });
    expect(
      buildTimelineEntries(messages, tools, null).some((entry) => entry.type === 'waiting'),
    ).toBe(false);
  });
});
