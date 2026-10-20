import type { Usage } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { messageUsage } from '../src/message-usage.js';

const empty: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe('public assistant token usage', () => {
  it('leaves unavailable provider usage absent instead of publishing Pi defaults as measured zero', () => {
    expect(messageUsage(empty)).toBeUndefined();
  });

  it('retains reported totals and cache counters without recomputing or including cost', () => {
    expect(
      messageUsage({
        ...empty,
        input: 100,
        output: 20,
        cacheRead: 80,
        cacheWrite: 10,
        totalTokens: 120,
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
      totalTokens: 120,
    });
  });

  it('keeps a cache-only provider report even when its other counters are zero', () => {
    expect(messageUsage({ ...empty, cacheRead: 10, totalTokens: 10 })).toMatchObject({
      cacheReadTokens: 10,
      totalTokens: 10,
    });
  });
});
