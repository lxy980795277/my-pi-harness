import { describe, expect, it } from 'vitest';
import {
  usageCost,
  usageFacts,
  usagePurposeLabel,
  usageText,
} from '../src/features/usage/utils/usage-view';
import { usageFixture } from './fixtures/usage';

describe('host-owned usage presentation', () => {
  it('retains provider total accounting without adding cache components', () => {
    const data = usageFixture();
    const text = usageText(data, false, null, '整棵任务树');
    expect(text.tokensLabel).toBe('用量 1.1K tok');
    expect(text.tokensTitle).toContain('总计 1,060 tok');
    expect(text.tokensTitle).toContain('缓存读取 400，缓存写入 50');
    expect(text.tokensTitle).toContain('整棵任务树');
    expect(text.tokensTitle).not.toContain('1,510');
    expect(text.coverageLabel).toBe('已记录 2 / 2 次模型调用');
  });

  it('labels partial usage and timing while retaining only observed amounts', () => {
    const data = usageFixture({
      recordedRequests: 1,
      unknownRequests: 1,
      timedRequests: 1,
      unknownDurationRequests: 1,
    });
    const text = usageText(data, false, null, '自身');
    expect(text.tokensLabel).toBe('部分用量 1.1K tok');
    expect(text.coverageLabel).toContain('1 次用量未知');
    expect(text.modelDurationLabel).toBe('3 秒（部分）');
  });

  it('distinguishes genuine reported zero from missing model usage and missing duration', () => {
    const absent = usageText(
      usageFixture({
        recordedRequests: 0,
        unknownRequests: 2,
        timedRequests: 0,
        unknownDurationRequests: 2,
        modelDurationMs: 0,
      }),
      false,
      null,
      '范围',
    );
    expect(absent.tokensLabel).toBe('用量未记录');
    expect(absent.modelDurationLabel).toBe('未记录');
    const zero = usageText(
      usageFixture({
        tokens: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
        },
      }),
      false,
      null,
      '范围',
    );
    expect(zero.tokensLabel).toBe('用量 0 tok');
  });

  it('keeps absent custom prices unknown and shows a known partial estimate explicitly', () => {
    const unknown = usageText(
      usageFixture({
        estimatedCostUsd: null,
        pricedRequests: 0,
        unknownPriceRequests: 2,
        estimatedRequests: 0,
        unknownEstimateRequests: 2,
        costComplete: false,
      }),
      false,
      null,
      '范围',
    );
    expect(unknown.costLabel).toBe('费用未知');
    expect(unknown.costLabel).not.toContain('$0');
    const partial = usageText(
      usageFixture({
        estimatedCostUsd: 0.02,
        estimatedRequests: 1,
        unknownEstimateRequests: 1,
        costComplete: false,
      }),
      false,
      null,
      '范围',
    );
    expect(partial.costLabel).toBe('模型部分估算 $0.02');
    expect(partial.costTitle).toContain('已估算 1 / 2 次请求');
    expect(partial.costTitle).toContain('不代表供应商账单');
    expect(usageCost(0.0000001)).toBe('< $0.000001');
    expect(usageCost(0)).toBe('$0.00');
  });

  it('does not call concurrent cumulative time a total wall duration', () => {
    const data = usageFixture({
      modelDurationMs: 10000,
      wallDurationMs: 5000,
      queueDurationMs: 3000,
      toolDurationMs: 2000,
      humanWaitMs: 1000,
    });
    const text = usageText(data, false, null, '范围');
    expect(text.durationLabel).toBe('用时 5 秒');
    expect(text.modelDurationLabel).toBe('10 秒');
    expect(text.queueLabel).toBe('3 秒');
    expect(text.toolLabel).toBe('2 秒');
    expect(text.humanLabel).toBe('1 秒');
    expect(usageFacts(data, text)).toContainEqual({ label: '累计模型耗时', value: '10 秒' });
  });

  it('names execution unions and request-only spans according to the host basis', () => {
    expect(
      usageText(usageFixture({ wallTimeBasis: 'execution-union' }), false, null, '范围')
        .durationTitle,
    ).toContain('区间并集');
    const request = usageText(usageFixture({ wallTimeBasis: 'request-span' }), false, null, '范围');
    expect(request.durationLabel).toBe('请求区间用时 5 秒');
    expect(request.durationTitle).toContain('不代表完整回答');
    const observed = usageText(
      usageFixture({ wallTimeBasis: 'observed-union' }),
      false,
      null,
      '范围',
    );
    expect(observed.durationLabel).toBe('观测区间用时 5 秒');
    expect(observed.durationTitle).toContain('区间并集');
    expect(
      usageText(
        usageFixture({ wallTimeBasis: 'unknown', wallDurationMs: null }),
        false,
        null,
        '范围',
      ).durationLabel,
    ).toBe('用时未记录');
  });

  it('preserves unknown human and tool timing rather than formatting an invented zero', () => {
    const text = usageText(
      usageFixture({
        timedQueueRequests: 0,
        unknownQueueRequests: 2,
        queueDurationMs: 0,
        toolCalls: 2,
        timedToolCalls: 0,
        unknownToolDurationCalls: 2,
        toolDurationMs: 0,
        humanWaitMs: 0,
        unknownHumanWaits: 1,
      }),
      false,
      null,
      '范围',
    );
    expect(text.toolLabel).toBe('未记录');
    expect(text.queueLabel).toBe('未记录');
    expect(text.humanLabel).toBe('未记录');
  });

  it('exposes loading and read failure separately from missing historical records', () => {
    expect(usageText(undefined, true, null, '范围').tokensLabel).toBe('正在读取用量');
    const failure = usageText(undefined, false, new Error('统计请求失败'), '范围');
    expect(failure.tokensLabel).toBe('统计读取失败');
    expect(failure.tokensTitle).toBe('统计请求失败');
    expect(failure.durationLabel).toBe('用时未记录');
    expect(usagePurposeLabel('compaction')).toBe('上下文压缩');
  });
});
