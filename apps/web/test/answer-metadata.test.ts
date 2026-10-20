import type { MessageUsage, MessageView, RunView } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import {
  buildAnswerFooters,
  equalAnswerMetadata,
} from '../src/features/sessions/utils/answer-metadata';
import { reasoningPreview } from '../src/features/sessions/utils/reasoning-preview';

const usage = (totalTokens: number): MessageUsage => {
  return {
    inputTokens: totalTokens - 20,
    outputTokens: 20,
    cacheReadTokens: 10,
    cacheWriteTokens: 5,
    totalTokens,
  };
};

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
    createdAt: 2_000,
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
    createdAt: 2_000,
    finishedAt: 43_010,
    error: null,
    ...fields,
  };
};

describe('answer metadata', () => {
  it('copies every visible assistant body in one answer without user, thinking or other inputs', () => {
    const messages = [
      message('user', 'user', { text: '用户问题' }),
      message('preamble', 'assistant', {
        text: '先检查文件。\n',
        thinking: '不复制这段思考',
        stopReason: 'toolUse',
      }),
      message('tool-only', 'assistant', { text: '', thinking: '另一次思考' }),
      message('answer', 'assistant', { text: '**检查结果**\n\n```ts\nconst answer = 42;\n```' }),
      message('next-user', 'user', { text: '另一个问题' }),
      message('next-answer', 'assistant', { text: '另一轮回答' }),
    ];
    const footers = buildAnswerFooters(messages, [run()], null, 'branch');
    expect(footers.get('answer')).toMatchObject({
      inputId: 'user',
      copyText: '先检查文件。\n\n\n**检查结果**\n\n```ts\nconst answer = 42;\n```',
    });
    expect(footers.get('next-answer')).toMatchObject({
      inputId: 'next-user',
      copyText: '另一轮回答',
    });
    expect(footers.has('preamble')).toBe(false);
    expect(footers.has('tool-only')).toBe(false);
  });

  it('counts empty tool steps and uses provider totals without adding cache tokens twice', () => {
    const messages = [
      message('user', 'user'),
      message('tool-step', 'assistant', { text: '', usage: usage(1_100), finishedAt: 5_000 }),
      message('answer', 'assistant', { usage: usage(230), finishedAt: 43_000 }),
    ];
    const metadata = buildAnswerFooters(messages, [run()], null, 'branch');
    expect([...metadata.keys()]).toEqual(['answer']);
    expect(metadata.get('answer')?.metadata).toMatchObject({
      tokensLabel: '用量 1.3K tok',
      tokensTitle:
        '总计 1,330 tok；输入 1,290，输出 40；缓存读取 20，缓存写入 10；仅主对话模型调用（含工具轮）',
      durationLabel: '用时 41 秒',
      dateTime: new Date(43_010).toISOString(),
    });
  });

  it('separates queued inputs within one run and settles earlier turns during later work', () => {
    const messages = [
      message('first-user', 'user'),
      message('first-answer', 'assistant', { usage: usage(100), finishedAt: 5_000 }),
      message('queued-user', 'user', { createdAt: 10_000 }),
      message('queued-answer', 'assistant', { usage: usage(200), finishedAt: 12_000 }),
    ];
    const active = buildAnswerFooters(
      messages,
      [run({ status: 'running', finishedAt: null })],
      'run',
      'branch',
    );
    expect([...active.keys()]).toEqual(['first-answer']);
    expect(active.get('first-answer')?.metadata).toMatchObject({
      tokensLabel: '用量 100 tok',
      durationLabel: '用时 3 秒',
    });
    expect(active.get('first-answer')).toMatchObject({
      inputId: 'first-user',
      copyText: 'first-answer',
    });
    const complete = buildAnswerFooters(messages, [run({ finishedAt: 12_000 })], null, 'branch');
    expect(complete.get('queued-answer')?.metadata).toMatchObject({
      tokensLabel: '用量 200 tok',
      durationLabel: '用时 2 秒',
    });
    expect(complete.get('queued-answer')).toMatchObject({
      inputId: 'queued-user',
      copyText: 'queued-answer',
    });
  });

  it('anchors the footer after a trailing empty assistant while retaining earlier visible bodies', () => {
    const messages = [
      message('user', 'user'),
      message('preamble', 'assistant', {
        text: '已完成第一步',
        usage: usage(100),
        finishedAt: 5_000,
      }),
      message('empty-final', 'assistant', {
        text: '',
        usage: usage(200),
        finishedAt: 6_000,
      }),
    ];
    const footers = buildAnswerFooters(messages, [run({ finishedAt: 6_000 })], null, 'branch');
    expect([...footers.keys()]).toEqual(['empty-final']);
    expect(footers.get('empty-final')).toMatchObject({
      inputId: 'user',
      copyText: '已完成第一步',
      metadata: { tokensLabel: '用量 300 tok', durationLabel: '用时 4 秒' },
    });
  });

  it('does not show final statistics between tool rounds or while the final message streams', () => {
    const messages = [
      message('user', 'user'),
      message('preamble', 'assistant', { usage: usage(100), finishedAt: 5_000 }),
    ];
    expect(
      buildAnswerFooters(messages, [run({ status: 'running', finishedAt: null })], 'run', 'branch')
        .size,
    ).toBe(0);
    const streaming = [
      ...messages,
      message('next-step', 'assistant', { status: 'streaming', text: '' }),
    ];
    expect(buildAnswerFooters(streaming, [run()], null, 'branch').size).toBe(0);
  });

  it('labels absent and partially recorded usage without inventing a complete total', () => {
    const messages = [
      message('user', 'user'),
      message('tool-step', 'assistant', { text: '' }),
      message('answer', 'assistant', { finishedAt: 5_000 }),
    ];
    expect(
      buildAnswerFooters(messages, [run()], null, 'branch').get('answer')?.metadata.tokensLabel,
    ).toBe('用量未记录');
    messages[2] = message('answer', 'assistant', { usage: usage(100), finishedAt: 5_000 });
    const partial = buildAnswerFooters(messages, [run()], null, 'branch').get('answer')?.metadata;
    expect(partial?.tokensLabel).toBe('部分用量 100 tok');
    expect(partial?.tokensTitle).toContain('已记录 1 / 2 次模型调用；总计 100 tok');
  });

  it('uses same-branch terminal run timing only when historical message timing is absent', () => {
    const messages = [message('user', 'user'), message('answer', 'assistant')];
    const metadata = buildAnswerFooters(messages, [run()], null, 'branch').get('answer')?.metadata;
    expect(metadata?.durationLabel).toBe('用时 41 秒');
    expect(metadata?.dateTime).toBe(new Date(43_010).toISOString());
    expect(
      buildAnswerFooters(messages, [run()], null, 'fork').get('answer')?.metadata,
    ).toMatchObject({
      durationLabel: '用时未记录',
      dateTime: new Date(2_000).toISOString(),
    });
  });

  it('keeps inherited message completion timing instead of a discarded branch run tail', () => {
    const messages = [
      message('user', 'user'),
      message('answer', 'assistant', { finishedAt: 5_000 }),
    ];
    expect(
      buildAnswerFooters(messages, [run({ finishedAt: 500_000 })], null, 'fork').get('answer')
        ?.metadata,
    ).toMatchObject({
      durationLabel: '用时 3 秒',
      dateTime: new Date(5_000).toISOString(),
    });
  });

  it('includes terminal tool and approval waiting after the last assistant step', () => {
    const messages = [
      message('user', 'user'),
      message('tool-preamble', 'assistant', {
        text: '正在检查文件',
        stopReason: 'toolUse',
        usage: usage(100),
        finishedAt: 5_000,
      }),
    ];
    for (const status of ['cancelled', 'failed', 'interrupted'] as const) {
      const metadata = buildAnswerFooters(
        messages,
        [run({ status, finishedAt: 35_000 })],
        null,
        'branch',
      ).get('tool-preamble')?.metadata;
      expect(metadata).toMatchObject({
        tokensLabel: '用量 100 tok',
        durationLabel: '用时 33 秒',
        dateTime: new Date(35_000).toISOString(),
      });
    }
  });

  it('distinguishes an unrecorded end time from a recorded start timestamp', () => {
    const messages = [message('user', 'user'), message('answer', 'assistant')];
    const metadata = buildAnswerFooters(messages, [], null, 'branch').get('answer')?.metadata;
    expect(metadata?.durationLabel).toBe('用时未记录');
    expect(metadata?.timeTitle).toMatch(/^开始生成：/u);
    expect(metadata?.timeLabel).toMatch(/^\d{2}:\d{2}$/u);
  });

  it('formats longer durations and prevents negative elapsed time after a wall-clock adjustment', () => {
    const messages = [
      message('user', 'user'),
      message('answer', 'assistant', { finishedAt: 127_000 }),
    ];
    expect(
      buildAnswerFooters(messages, [], null, 'branch').get('answer')?.metadata.durationLabel,
    ).toBe('用时 2 分 5 秒');
    messages[1] = message('answer', 'assistant', { finishedAt: 1_000 });
    expect(
      buildAnswerFooters(messages, [], null, 'branch').get('answer')?.metadata.durationLabel,
    ).toBe('用时 0 秒');
  });

  it('retains recorded statistics for cancelled, failed and interrupted partial answers', () => {
    for (const status of ['cancelled', 'failed', 'interrupted'] as const) {
      const messages = [
        message('user', 'user'),
        message('answer', 'assistant', { status, usage: usage(100), finishedAt: 5_000 }),
      ];
      expect(
        buildAnswerFooters(messages, [run({ status, finishedAt: 5_000 })], null, 'branch').get(
          'answer',
        )?.metadata,
      ).toMatchObject({
        tokensLabel: '用量 100 tok',
        durationLabel: '用时 3 秒',
      });
      expect(
        buildAnswerFooters(messages, [run({ status, finishedAt: 5_000 })], null, 'branch').get(
          'answer',
        ),
      ).toMatchObject({ inputId: 'user', copyText: 'answer' });
      messages[1] = message('answer', 'assistant', { status, text: '', finishedAt: 5_000 });
      expect(buildAnswerFooters(messages, [run({ status })], null, 'branch').size).toBe(0);
    }
  });

  it('includes completed steps and a cancelled partial body in the same copied answer', () => {
    const messages = [
      message('user', 'user'),
      message('preamble', 'assistant', { text: '工具前说明', stopReason: 'toolUse' }),
      message('partial', 'assistant', {
        text: '工具后尚未写完的正文',
        thinking: '仍不复制思考',
        status: 'cancelled',
        finishedAt: 5_000,
      }),
    ];
    const footers = buildAnswerFooters(
      messages,
      [run({ status: 'cancelled', finishedAt: 5_000 })],
      null,
      'branch',
    );
    expect([...footers.keys()]).toEqual(['partial']);
    expect(footers.get('partial')).toMatchObject({
      inputId: 'user',
      copyText: '工具前说明\n\n工具后尚未写完的正文',
    });
  });

  it('reuses equivalent historical footer values while detecting a newly completed answer', () => {
    const messages = [
      message('user', 'user'),
      message('answer', 'assistant', { usage: usage(100), finishedAt: 5_000 }),
    ];
    const first = buildAnswerFooters(messages, [run()], null, 'branch').get('answer')?.metadata;
    const next = buildAnswerFooters(messages, [run()], null, 'branch').get('answer')?.metadata;
    expect(equalAnswerMetadata(first, next)).toBe(true);
    expect(equalAnswerMetadata(first, undefined)).toBe(false);
    expect(equalAnswerMetadata(undefined, undefined)).toBe(true);
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
