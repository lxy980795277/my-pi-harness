import type { MessageView, RunView } from '@my-pi-harness/protocol';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { projectionMessage, sessionProjection } from '../../../tests/fixtures/session-projection';
import { RequestFailure } from '../src/components/request-failure';
import { buildTimelineEntries } from '../src/features/sessions/utils/timeline-entries';
import { buildRunFailures, requestFailureText } from '../src/utils/run-failure';

const failure = (changes: Partial<RunView> = {}): RunView => {
  const run = sessionProjection().runs[0];
  if (run === undefined) throw new Error('Missing fixture run');
  return {
    ...run,
    status: 'failed',
    finishedAt: 10,
    error: '模型请求超时，请稍后重试。',
    ...changes,
  };
};
const assistant = (status: MessageView['status'] = 'failed'): MessageView => {
  return { ...projectionMessage(sessionProjection()), text: '已生成的部分正文', status };
};

describe('request errors belong to their answer', () => {
  it('presents historical generic errors locally and renders provider text without Markdown or HTML', () => {
    for (const text of [null, '', 'Model request failed', 'The model request did not complete.'])
      expect(requestFailureText(text)).toBe('模型请求失败，请稍后重试。');
    const original = failure({ error: 'The model request did not complete.' });
    expect(buildRunFailures([assistant()], [original]).messages.get('assistant')).toBe(
      '模型请求失败，请稍后重试。',
    );
    expect(original.error).toBe('The model request did not complete.');
    const content = '<img src=x onerror=alert(1)> **错误**';
    const markup = renderToStaticMarkup(createElement(RequestFailure, { text: content }));
    expect(markup).toContain('&lt;img');
    expect(markup).toContain('**错误**');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<strong');
  });

  it('keeps an earlier failure beside its partial text when a later request succeeds', () => {
    const failed = assistant();
    const later = {
      ...failed,
      id: 'success',
      runId: 'next-run',
      status: 'complete' as const,
      text: '新的成功回答',
      stopReason: 'stop',
    };
    const entries = buildTimelineEntries(
      [
        projectionMessage(sessionProjection(), 'user'),
        failed,
        { ...projectionMessage(sessionProjection(), 'user'), id: 'next-user', runId: 'next-run' },
        later,
      ],
      [],
      null,
      [failure(), failure({ id: 'next-run', status: 'completed', error: null })],
      'main',
    );
    expect(
      entries.find((entry) => {
        return entry.id === 'message:assistant';
      }),
    ).toMatchObject({
      type: 'message',
      message: { text: '已生成的部分正文' },
      failure: '模型请求超时，请稍后重试。',
    });
    expect(
      entries.find((entry) => {
        return entry.id === 'message:success';
      }),
    ).not.toHaveProperty('failure');
    expect(
      entries.filter((entry) => {
        return entry.type === 'request-error';
      }),
    ).toEqual([]);
  });

  it('shows a failed execution reason on its aborted partial without relabeling a genuine user cancellation', () => {
    const partial = assistant('cancelled');
    expect(buildRunFailures([partial], [failure()]).messages.get(partial.id)).toBe(
      '模型请求超时，请稍后重试。',
    );
    expect(
      buildRunFailures([partial], [failure({ status: 'cancelled', error: null })]).messages.size,
    ).toBe(0);
    expect(
      buildRunFailures([partial], [failure({ status: 'cancelled', error: null })]).unattached,
    ).toEqual([]);
  });

  it('uses an independent row after completed text and before later runs when no failed message exists', () => {
    const preamble = assistant('complete');
    const nextInput = {
      ...projectionMessage(sessionProjection(), 'user'),
      id: 'next-user',
      runId: 'next-run',
    };
    const runs = [failure(), failure({ id: 'next-run', status: 'completed', error: null })];
    const entries = buildTimelineEntries([preamble, nextInput], [], null, runs, 'main');
    expect(
      entries.map((entry) => {
        return entry.id;
      }),
    ).toEqual(['message:assistant', 'request-error:run', 'message:next-user']);
    expect(entries[0]).not.toHaveProperty('failure');
    expect(entries[1]).toMatchObject({ type: 'request-error', text: '模型请求超时，请稍后重试。' });
    const noMessage = buildTimelineEntries([nextInput], [], null, runs, 'main');
    expect(
      noMessage.map((entry) => {
        return entry.id;
      }),
    ).toEqual(['request-error:run', 'message:next-user']);
    expect(buildTimelineEntries([], [], null, [failure()], 'main')).toEqual([
      {
        type: 'request-error',
        id: 'request-error:run',
        runId: 'run',
        text: '模型请求超时，请稍后重试。',
      },
    ]);
  });

  it('retains an inherited visible failure reason without adding the discarded branch tail', () => {
    const run = failure();
    const visible = buildRunFailures([assistant()], [run], 'revision');
    expect(visible.messages.get('assistant')).toBe(run.error);
    expect(visible.unattached).toEqual([]);
    expect(buildRunFailures([assistant('complete')], [run], 'revision').unattached).toEqual([]);
  });
});
