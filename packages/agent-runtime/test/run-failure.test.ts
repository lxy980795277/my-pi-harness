import { describe, expect, it } from 'vitest';
import { RuntimeError } from '../src/errors.js';
import { runFailureMessage } from '../src/runs/failure.js';

describe('public model failure messages', () => {
  it.each([
    ['Request timed out.', '模型请求超时，请稍后重试。'],
    ['TypeError: fetch failed; ECONNRESET', '无法连接模型服务，请检查网络后重试。'],
    [
      '401 invalid_api_key: private-test-key-error',
      '模型服务认证失败，请检查 API Key 或授权状态。',
    ],
    ['429 Too Many Requests: private-test-key-error', '模型服务请求过于频繁，请稍后重试。'],
    ['503 Service Unavailable: private-test-key-error', '模型服务暂时不可用，请稍后重试。'],
    ['private-test-key-error', '模型请求失败，请稍后重试。'],
    [undefined, '模型请求失败，请稍后重试。'],
  ])('classifies SDK %s without returning provider text', (message, expected) => {
    const result = runFailureMessage({ kind: 'model', message });
    expect(result).toBe(expected);
    expect(result).not.toContain('private-test-key-error');
  });

  it('preserves controlled runtime reasons and keeps unknown owned failures generic', () => {
    expect(
      runFailureMessage({
        kind: 'owned',
        cause: new RuntimeError('AGENT_TURN_LIMIT', '任务已达到模型请求轮数上限。'),
      }),
    ).toBe('任务已达到模型请求轮数上限。');
    expect(
      runFailureMessage({ kind: 'owned', cause: new Error('401 private-test-key-error') }),
    ).toBe('模型请求失败，请稍后重试。');
    expect(
      runFailureMessage({
        kind: 'owned',
        cause: { headers: { authorization: 'private-test-key-error' }, body: 'Request timed out.' },
      }),
    ).toBe('模型请求失败，请稍后重试。');
  });
});
