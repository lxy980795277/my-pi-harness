import type { MessageView, RunView, ToolCallView } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import { buildTimelineEntries } from '../src/features/sessions/utils/timeline-entries';
import { estimateTimelineEntry } from '../src/features/sessions/utils/timeline-layout';

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
    binding: { kind: 'accepted', source: { kind: 'workspace' }, fingerprint: 'a'.repeat(64) },
    dispatch: { state: 'not_applicable' },
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

const successfulAnswer = (id = 'final', createdAt = 5000): MessageView => {
  return { ...message(id, 'assistant', createdAt), stopReason: 'stop', finishedAt: 42_010 };
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
    const expected = ['message:user'];
    if (content.thinking.length > 0) expected.push('thinking:assistant');
    expected.push('message:assistant');
    expect(entries.map((entry) => entry.id)).toEqual(expected);
    expect(entries.at(-1)).toMatchObject({ type: 'message', message: assistant });
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

  it('keeps completed thinking as its own row without an empty body before its tools', () => {
    const assistant = {
      ...message('assistant', 'assistant', 20),
      text: '',
      thinking: '先核对工具结果',
      stopReason: 'toolUse',
    };
    const entries = buildTimelineEntries(
      [message('user', 'user', 10), assistant],
      [tool('read', assistant.id, 30)],
      null,
    );
    expect(entries.map((entry) => entry.id)).toEqual([
      'message:user',
      'thinking:assistant',
      'tool:read',
    ]);
    const thought = entries[1];
    if (thought?.type !== 'message') throw new Error('Missing standalone thinking');
    expect(thought.part).toBe('thinking');
    expect(thought.message).toBe(assistant);
  });

  it.each(['streaming', 'failed', 'cancelled', 'interrupted'] as const)(
    'retains the %s status body below standalone thinking even without prose',
    (status) => {
      const assistant = {
        ...message('assistant', 'assistant', 20),
        text: '',
        thinking: '当前思考',
        status,
      };
      let activeRunId: string | null = null;
      if (status === 'streaming') activeRunId = 'run';
      const entries = buildTimelineEntries(
        [message('user', 'user', 10), assistant],
        [],
        activeRunId,
      );
      expect(entries.map((entry) => entry.id)).toEqual([
        'message:user',
        'thinking:assistant',
        'message:assistant',
      ]);
      expect(entries[2]).toMatchObject({ type: 'message', part: 'body', message: assistant });
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

describe('settled answer process disclosure', () => {
  it('groups ordered intermediate steps and final thinking while retaining every original message and tool', () => {
    const input = message('input', 'user', 1000);
    const first = {
      ...message('first', 'assistant', 3000),
      thinking: 'first thought',
      stopReason: 'toolUse',
    };
    const second = { ...message('second', 'assistant', 2000), stopReason: 'toolUse' };
    const final = { ...successfulAnswer(), thinking: 'final thought' };
    const messages = [input, first, second, final];
    const tools = [
      tool('second-id', first.id, 500),
      tool('first-id', first.id, 400),
      tool('third', second.id, 300),
    ];
    const original = JSON.stringify({ messages, tools });
    const entries = buildTimelineEntries(
      messages,
      tools,
      null,
      [{ ...run(), finishedAt: 42_010 }],
      'branch',
    );
    expect(entries.map((entry) => entry.id)).toEqual([
      'message:input',
      'process:input',
      'message:final',
      'answer:input',
    ]);
    const process = entries[1];
    if (process?.type !== 'process') throw new Error('Missing process disclosure');
    expect(process).toMatchObject({ sessionId: 'session', inputId: 'input', durationLabel: '41s' });
    expect(process.entries.map((entry) => entry.id)).toEqual([
      'thinking:first',
      'message:first',
      'tool:second-id',
      'tool:first-id',
      'message:second',
      'tool:third',
      'thinking:final',
    ]);
    expect(process.entries[0]).toMatchObject({ type: 'message', part: 'thinking', message: first });
    expect(process.entries[1]).toMatchObject({ type: 'message', part: 'body', message: first });
    expect(process.entries[2]).toMatchObject({ type: 'tool', tool: tools[0] });
    expect(process.entries.at(-1)).toMatchObject({
      type: 'message',
      part: 'thinking',
      message: final,
    });
    const finalBody = entries[2];
    if (finalBody?.type !== 'message') throw new Error('Missing final answer body');
    expect(finalBody.part).toBe('body');
    expect(finalBody.message).toBe(final);
    const finalThinking = process.entries.at(-1);
    if (finalThinking?.type !== 'message') throw new Error('Missing final thinking');
    expect(finalThinking.message).toBe(final);
    const processTool = process.entries[2];
    if (processTool?.type !== 'tool') throw new Error('Missing process tool');
    expect(processTool.tool).toBe(tools[0]);
    expect(entries.at(-1)).toMatchObject({
      type: 'answer-footer',
      footer: { copyText: 'first\n\nsecond\n\nfinal' },
    });
    expect(JSON.stringify({ messages, tools })).toBe(original);
    expect(estimateTimelineEntry(process)).toBe(36);
  });

  it('does not add a process row for a direct plain-text answer', () => {
    const entries = buildTimelineEntries(
      [message('input', 'user', 1000), successfulAnswer()],
      [],
      null,
      [run()],
      'branch',
    );
    expect(entries.map((entry) => entry.type)).toEqual(['message', 'message', 'answer-footer']);
    expect(entries[1]).not.toHaveProperty('part');
  });

  it('separates the final step thought even when there are no intermediate tool rounds', () => {
    const final = { ...successfulAnswer(), thinking: 'final thought' };
    const entries = buildTimelineEntries(
      [message('input', 'user', 1000), final],
      [],
      null,
      [{ ...run(), finishedAt: 855_000 }],
      'branch',
    );
    const process = entries[1];
    expect(process).toMatchObject({
      type: 'process',
      durationLabel: '14m 14s',
      entries: [{ id: 'thinking:final', part: 'thinking', message: final }],
    });
    expect(entries[2]).toMatchObject({
      type: 'message',
      id: 'message:final',
      part: 'body',
      message: final,
    });
  });

  it('keeps the final body row unchanged when its already separate thinking enters the process', () => {
    const final = {
      ...successfulAnswer(),
      text: '正式回答正文。'.repeat(1000),
      thinking: '最终正文之前的思考',
    };
    const messages = [message('input', 'user', 1000), final];
    const active = buildTimelineEntries(messages, [], 'run', [run('running')], 'branch');
    const settled = buildTimelineEntries(messages, [], null, [run()], 'branch');
    const activeBody = active.find((entry) => entry.id === 'message:final');
    const settledBody = settled.find((entry) => entry.id === 'message:final');
    expect(activeBody).toMatchObject({ type: 'message', part: 'body', message: final });
    expect(settledBody).toEqual(activeBody);
    const activeThoughts = active.filter((entry) => entry.id === 'thinking:final');
    expect(activeThoughts).toHaveLength(1);
    const activeThought = activeThoughts[0];
    if (activeThought?.type !== 'message') throw new Error('Missing active thinking');
    expect(activeThought.message).toBe(final);
    expect(estimateTimelineEntry(activeThought)).toBe(32);
    const process = settled.find((entry) => entry.type === 'process');
    if (process === undefined) throw new Error('Missing settled process');
    expect(process.entries).toEqual(activeThoughts);
    expect(settled.filter((entry) => entry.id === 'thinking:final')).toHaveLength(0);
    if (settledBody?.type !== 'message') throw new Error('Missing settled body');
    expect(settledBody.message).toBe(final);
  });

  it.each(['running', 'reviewing', 'awaiting_approval', 'unknown'] as const)(
    'keeps %s tool activity outside successful folding',
    (status) => {
      const first = { ...message('first', 'assistant', 2000), stopReason: 'toolUse' };
      const entries = buildTimelineEntries(
        [message('input', 'user', 1000), first, successfulAnswer()],
        [{ ...tool('call', first.id, 3000), status }],
        null,
        [run()],
        'branch',
      );
      expect(entries.map((entry) => entry.id)).toEqual([
        'message:input',
        'message:first',
        'tool:call',
        'message:final',
        'answer:input',
      ]);
    },
  );

  it.each(['failed', 'cancelled', 'interrupted'] as const)(
    'keeps a %s Run and its partial assistant content visible',
    (status) => {
      const first = { ...message('first', 'assistant', 2000), stopReason: 'toolUse' };
      const final = { ...successfulAnswer(), status };
      const entries = buildTimelineEntries(
        [message('input', 'user', 1000), first, final],
        [tool('call', first.id, 3000)],
        null,
        [run(status)],
        'branch',
      );
      expect(entries.some((entry) => entry.type === 'process')).toBe(false);
      expect(entries).toContainEqual(expect.objectContaining({ type: 'message', message: final }));
      expect(entries.at(-1)).toMatchObject({
        type: 'answer-footer',
        footer: { copyText: 'first\n\nfinal' },
      });
    },
  );

  it.each(['failed', 'cancelled', 'interrupted'] as const)(
    'does not infer success from a complete message in a %s Run',
    (status) => {
      const entries = buildTimelineEntries(
        [message('input', 'user', 1000), { ...successfulAnswer(), thinking: 'thought' }],
        [],
        null,
        [run(status)],
        'branch',
      );
      expect(entries.some((entry) => entry.type === 'process')).toBe(false);
    },
  );

  it('waits for the Run terminal state and preserves waiting and streaming rows', () => {
    const input = message('input', 'user', 1000);
    const first = { ...message('first', 'assistant', 2000), stopReason: 'toolUse' };
    const completed = successfulAnswer();
    const active = buildTimelineEntries(
      [input, first, completed],
      [tool('call', first.id, 3000)],
      'run',
      [run('running')],
      'branch',
    );
    expect(active.map((entry) => entry.id)).toEqual([
      'message:input',
      'message:first',
      'tool:call',
      'message:final',
      'waiting:run',
    ]);
    const streaming = { ...completed, status: 'streaming' as const };
    expect(
      buildTimelineEntries([input, first, streaming], [], 'run', [run('running')], 'branch').map(
        (entry) => entry.type,
      ),
    ).toEqual(['message', 'message', 'message']);
    expect(
      buildTimelineEntries([input, first, completed], [], 'run', [run()], 'branch').some(
        (entry) => entry.type === 'process',
      ),
    ).toBe(false);
  });

  it('requires real final prose after all tool activity, rather than promoting a tool-use preamble', () => {
    const input = message('input', 'user', 1000);
    const first = { ...message('first', 'assistant', 2000), stopReason: 'toolUse' };
    for (const messages of [
      [input, first],
      [input, first, { ...successfulAnswer(), text: '' }],
      [input, first, { ...successfulAnswer(), text: '', thinking: 'thought without answer' }],
    ]) {
      const entries = buildTimelineEntries(
        messages,
        [tool('call', first.id, 3000)],
        null,
        [run()],
        'branch',
      );
      expect(entries.some((entry) => entry.type === 'process')).toBe(false);
    }
    const trailing = buildTimelineEntries(
      [input, first, successfulAnswer()],
      [tool('trailing', 'final', 5000)],
      null,
      [run()],
      'branch',
    );
    expect(trailing.some((entry) => entry.type === 'process')).toBe(false);
  });

  it('folds a successful earlier input while a queued input streams in the same Run', () => {
    const final = {
      ...successfulAnswer('first-final'),
      thinking: 'first thought',
      finishedAt: 16_000,
    };
    const next = { ...message('next-final', 'assistant', 21_000), status: 'streaming' as const };
    const entries = buildTimelineEntries(
      [message('first-input', 'user', 1000), final, message('next-input', 'user', 20_000), next],
      [],
      'run',
      [run('running')],
      'branch',
    );
    expect(entries.map((entry) => entry.id)).toEqual([
      'message:first-input',
      'process:first-input',
      'message:first-final',
      'answer:first-input',
      'message:next-input',
      'message:next-final',
    ]);
    expect(entries[1]).toMatchObject({
      type: 'process',
      inputId: 'first-input',
      durationLabel: '15s',
    });
    expect(entries[3]).toMatchObject({
      type: 'answer-footer',
      footer: { copyText: 'first-final' },
    });
  });

  it('does not reopen a successful earlier process when the later queued input fails', () => {
    const final = {
      ...successfulAnswer('first-final'),
      thinking: 'first thought',
      finishedAt: 16_000,
    };
    const next = {
      ...message('next-final', 'assistant', 21_000),
      status: 'failed' as const,
      stopReason: 'error',
    };
    const entries = buildTimelineEntries(
      [message('first-input', 'user', 1000), final, message('next-input', 'user', 20_000), next],
      [],
      null,
      [run('failed')],
      'branch',
    );
    expect(
      entries.filter((entry) => entry.type === 'process').map((entry) => entry.inputId),
    ).toEqual(['first-input']);
    expect(entries.at(-2)).toMatchObject({ type: 'message', message: next });
  });

  it('uses inherited final completion without importing the original branch Run tail or outcome', () => {
    const final = { ...successfulAnswer(), thinking: 'recorded thought', finishedAt: 14_000 };
    const entries = buildTimelineEntries(
      [message('input', 'user', 1000), final],
      [],
      null,
      [{ ...run('failed'), finishedAt: 900_000 }],
      'fork',
    );
    expect(entries[1]).toMatchObject({ type: 'process', durationLabel: '13s' });
    expect(entries.at(-1)).toMatchObject({
      type: 'answer-footer',
      footer: { metadata: { dateTime: new Date(14_000).toISOString() } },
    });
    const missingTiming = { ...successfulAnswer(), thinking: 'recorded thought' };
    delete missingTiming.finishedAt;
    expect(
      buildTimelineEntries(
        [message('input', 'user', 1000), missingTiming],
        [],
        null,
        [run()],
        'fork',
      ).some((entry) => entry.type === 'process'),
    ).toBe(false);
  });

  it('does not invent elapsed time or a successful outcome from missing metadata', () => {
    const final = { ...successfulAnswer(), thinking: 'thought' };
    delete final.finishedAt;
    const messages = [message('input', 'user', 1000), final];
    const entries = buildTimelineEntries(
      messages,
      [],
      null,
      [{ ...run(), finishedAt: null }],
      'branch',
    );
    expect(entries[1]).toMatchObject({ type: 'process', durationLabel: '' });
    expect(
      buildTimelineEntries(messages, [], null, [], 'branch').some(
        (entry) => entry.type === 'process',
      ),
    ).toBe(false);
  });
});
