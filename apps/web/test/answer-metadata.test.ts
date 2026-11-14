import type { MessageView, RunView } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import {
  buildAnswerFooters,
  equalAnswerTimestamp,
} from '../src/features/sessions/utils/answer-metadata';
import { reasoningPreview } from '../src/components/message-thinking/preview';

const message = (
  id: string,
  role: MessageView['role'],
  fields: Partial<MessageView> = {},
): MessageView => {
  return {
    id,
    role,
    sessionId: 'session',
    branchId: 'branch',
    runId: 'run',
    createdAt: 2000,
    text: id,
    thinking: '',
    status: 'complete',
    stopReason: null,
    ...fields,
  };
};
const run = (fields: Partial<RunView> = {}): RunView => {
  return {
    id: 'run',
    sessionId: 'session',
    branchId: 'branch',
    providerId: 'provider',
    modelId: 'model',
    status: 'completed',
    createdAt: 2000,
    finishedAt: 43010,
    error: null,
    ...fields,
  };
};

describe('answer ownership and recorded timestamp', () => {
  it('copies all assistant bodies in one turn without user text, thinking or another input', () => {
    const messages = [
      message('user', 'user', { text: '用户问题' }),
      message('preamble', 'assistant', {
        text: '先检查文件。',
        thinking: '不复制的思考',
        stopReason: 'toolUse',
      }),
      message('empty', 'assistant', { text: '' }),
      message('answer', 'assistant', { text: '**检查结果**' }),
      message('next-user', 'user'),
      message('next-answer', 'assistant'),
    ];
    const footers = buildAnswerFooters(messages, [run()], null, 'branch');
    expect(footers.get('answer')).toMatchObject({
      inputId: 'user',
      copyText: '先检查文件。\n\n**检查结果**',
    });
    expect(footers.get('answer')?.memoryMessage).toBe(messages[3]);
    expect(footers.get('next-answer')).toMatchObject({
      inputId: 'next-user',
      copyText: 'next-answer',
    });
    expect(footers.has('preamble')).toBe(false);
    expect(footers.has('empty')).toBe(false);
  });

  it('separates consumed follow-ups in the same Run and settles earlier turns during later work', () => {
    const messages = [
      message('first-user', 'user'),
      message('first-answer', 'assistant', { finishedAt: 5000 }),
      message('queued-user', 'user', { createdAt: 10000 }),
      message('queued-answer', 'assistant', { finishedAt: 12000 }),
    ];
    const active = buildAnswerFooters(
      messages,
      [run({ status: 'running', finishedAt: null })],
      'run',
      'branch',
    );
    expect([...active.keys()]).toEqual(['first-answer']);
    expect(active.get('first-answer')).toMatchObject({
      inputId: 'first-user',
      timestamp: { dateTime: new Date(5000).toISOString() },
    });
    const completed = buildAnswerFooters(messages, [run({ finishedAt: 12000 })], null, 'branch');
    expect(completed.get('queued-answer')).toMatchObject({
      inputId: 'queued-user',
      timestamp: { dateTime: new Date(12000).toISOString() },
    });
  });

  it('anchors an answer after its trailing empty assistant and retains the last committed timestamp', () => {
    const messages = [
      message('user', 'user'),
      message('preamble', 'assistant', { text: '已完成第一步', finishedAt: 5000 }),
      message('empty-final', 'assistant', { text: '', finishedAt: 6000 }),
    ];
    const footers = buildAnswerFooters(messages, [run({ finishedAt: 6000 })], null, 'branch');
    expect([...footers.keys()]).toEqual(['empty-final']);
    expect(footers.get('empty-final')).toMatchObject({
      inputId: 'user',
      copyText: '已完成第一步',
      timestamp: { dateTime: new Date(6000).toISOString() },
    });
  });

  it('does not expose a final footer between tool rounds or while the final body streams', () => {
    const messages = [
      message('user', 'user'),
      message('preamble', 'assistant', { finishedAt: 5000 }),
    ];
    expect(
      buildAnswerFooters(messages, [run({ status: 'running', finishedAt: null })], 'run', 'branch')
        .size,
    ).toBe(0);
    expect(
      buildAnswerFooters(
        [...messages, message('next', 'assistant', { status: 'streaming' })],
        [run()],
        null,
        'branch',
      ).size,
    ).toBe(0);
  });

  it('retains an inherited message time rather than the discarded branch tail', () => {
    const messages = [
      message('user', 'user'),
      message('answer', 'assistant', { finishedAt: 5000 }),
    ];
    expect(
      buildAnswerFooters(messages, [run({ finishedAt: 500000 })], null, 'fork').get('answer')
        ?.timestamp.dateTime,
    ).toBe(new Date(5000).toISOString());
    const unfinished = [message('user', 'user'), message('answer', 'assistant')];
    expect(
      buildAnswerFooters(unfinished, [run()], null, 'fork').get('answer')?.timestamp,
    ).toMatchObject({
      dateTime: new Date(2000).toISOString(),
    });
    expect(
      buildAnswerFooters(unfinished, [run()], null, 'fork').get('answer')?.timestamp.timeTitle,
    ).toMatch(/^开始生成：/u);
  });

  it('keeps terminal partial answers and includes waiting after the last assistant in the timestamp', () => {
    for (const status of ['cancelled', 'failed', 'interrupted'] as const) {
      const messages = [
        message('user', 'user'),
        message('answer', 'assistant', { status, finishedAt: 5000 }),
      ];
      expect(
        buildAnswerFooters(messages, [run({ status, finishedAt: 35000 })], null, 'branch').get(
          'answer',
        ),
      ).toMatchObject({
        inputId: 'user',
        copyText: 'answer',
        timestamp: { dateTime: new Date(35000).toISOString() },
      });
      messages[1] = message('answer', 'assistant', { status, text: '', finishedAt: 5000 });
      expect(buildAnswerFooters(messages, [run({ status })], null, 'branch').size).toBe(0);
    }
  });

  it('does not aggregate legacy message Usage or calculate elapsed time in the presentation model', () => {
    const messages = [
      message('user', 'user'),
      message('answer', 'assistant', {
        usage: {
          inputTokens: 1000,
          outputTokens: 10,
          cacheReadTokens: 500,
          cacheWriteTokens: 0,
          totalTokens: 1010,
        },
        finishedAt: 5000,
      }),
    ];
    const footer = buildAnswerFooters(messages, [run()], null, 'branch').get('answer');
    expect(footer?.timestamp.dateTime).toBe(new Date(43010).toISOString());
    expect(footer?.timestamp.timeLabel).toMatch(/^\d{2}:\d{2}$/u);
    expect(Object.keys(footer?.timestamp ?? {}).sort()).toEqual([
      'dateTime',
      'timeLabel',
      'timeTitle',
    ]);
    expect(footer).not.toHaveProperty('metadata');
    expect(footer?.timestamp).not.toHaveProperty('tokensLabel');
    expect(footer?.timestamp).not.toHaveProperty('durationLabel');
  });

  it('compares recorded timestamps independently of later request Usage updates', () => {
    const messages = [
      message('user', 'user'),
      message('answer', 'assistant', { finishedAt: 5000 }),
    ];
    const first = buildAnswerFooters(messages, [run()], null, 'branch').get('answer')?.timestamp;
    const next = buildAnswerFooters(messages, [run()], null, 'branch').get('answer')?.timestamp;
    expect(equalAnswerTimestamp(first, next)).toBe(true);
    expect(equalAnswerTimestamp(first, undefined)).toBe(false);
    expect(equalAnswerTimestamp(undefined, undefined)).toBe(true);
  });
});

describe('reasoning preview', () => {
  it('collapses whitespace and bounds the summary without changing the source detail', () => {
    const text = `\n检查\n\t${'推理'.repeat(100)}  `;
    const preview = reasoningPreview(text);
    expect(preview).toHaveLength(161);
    expect(preview).toMatch(/^检查 /u);
    expect(preview).toMatch(/…$/u);
    expect(text).toContain('\n\t');
    expect(reasoningPreview('\n简短\t推理\n')).toBe('简短 推理');
  });
});
