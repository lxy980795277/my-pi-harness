import type { ModelRequestPurpose, SessionUsage } from '@my-pi-harness/protocol';

export interface UsageText {
  tokensLabel: string;
  tokensTitle: string;
  durationLabel: string;
  durationTitle: string;
  modelDurationLabel: string;
  coverageLabel: string;
  costLabel: string;
  costTitle: string;
  queueLabel: string;
  toolLabel: string;
  humanLabel: string;
}

export interface UsageFact {
  label: string;
  value: string;
}

const COMPACT_TOKENS = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const EXACT_NUMBER = new Intl.NumberFormat('zh-CN');
const USD = new Intl.NumberFormat('en', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});
const SECONDS = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const PURPOSES: Record<ModelRequestPurpose, string> = {
  conversation: '对话模型',
  approval: '审批复核',
  compaction: '上下文压缩',
};

export const usagePurposeLabel = (purpose: ModelRequestPurpose): string => {
  return PURPOSES[purpose];
};

/** Totals follow provider accounting, so cache components are never added to total again. */
export const usageTokenNumber = (tokens: number): string => {
  return COMPACT_TOKENS.format(tokens) + ' tok';
};

export const usageDuration = (durationMs: number): string => {
  const seconds = Math.max(0, durationMs) / 1000;
  if (seconds < 60) return SECONDS.format(seconds) + ' 秒';
  return Math.floor(seconds / 60) + ' 分 ' + Math.floor(seconds % 60) + ' 秒';
};

export const usageCost = (value: number): string => {
  if (value > 0 && value < 0.000001) return '< $0.000001';
  return USD.format(value);
};

/** Only request facts can establish complete or partial usage; missing data never becomes a measured zero. */
export const usageText = (
  usage: SessionUsage | undefined,
  pending: boolean,
  error: Error | null,
  scopeLabel: string,
): UsageText => {
  const unknown: UsageText = {
    tokensLabel: '用量未记录',
    tokensTitle: '尚无可核对的请求用量',
    durationLabel: '用时未记录',
    durationTitle: '缺少所选范围的完整执行时间',
    modelDurationLabel: '未记录',
    coverageLabel: '暂无请求记录',
    costLabel: '费用未知',
    costTitle: '未记录可核对的Usage或模型价格',
    queueLabel: '未记录',
    toolLabel: '未记录',
    humanLabel: '未记录',
  };
  if (error !== null)
    return {
      ...unknown,
      tokensLabel: '统计读取失败',
      tokensTitle: error.message,
      durationTitle: error.message,
    };
  if (usage === undefined) {
    if (pending) return { ...unknown, tokensLabel: '正在读取用量' };
    return unknown;
  }
  const result = { ...unknown };
  if (usage.recordedRequests > 0) {
    let prefix = '用量 ';
    if (usage.unknownRequests > 0) prefix = '部分用量 ';
    result.tokensLabel = prefix + usageTokenNumber(usage.tokens.totalTokens);
    result.tokensTitle =
      scopeLabel +
      '；已记录 ' +
      usage.recordedRequests +
      ' / ' +
      usage.requestCount +
      ' 次模型调用；总计 ' +
      EXACT_NUMBER.format(usage.tokens.totalTokens) +
      ' tok；' +
      '输入 ' +
      EXACT_NUMBER.format(usage.tokens.inputTokens) +
      '，输出 ' +
      EXACT_NUMBER.format(usage.tokens.outputTokens) +
      '；缓存读取 ' +
      EXACT_NUMBER.format(usage.tokens.cacheReadTokens) +
      '，缓存写入 ' +
      EXACT_NUMBER.format(usage.tokens.cacheWriteTokens);
  }
  result.coverageLabel =
    '已记录 ' + usage.recordedRequests + ' / ' + usage.requestCount + ' 次模型调用';
  if (usage.unknownRequests > 0)
    result.coverageLabel += ' · ' + usage.unknownRequests + ' 次用量未知';
  if (usage.wallDurationMs !== null && usage.wallTimeBasis !== 'unknown') {
    result.durationLabel = '执行时长 ' + usageDuration(usage.wallDurationMs);
    result.durationTitle = '所选执行范围的Run生命周期区间并集，重叠区间只计算一次';
    if (usage.wallTimeBasis === 'answer-span') {
      result.durationLabel = '用时 ' + usageDuration(usage.wallDurationMs);
      result.durationTitle = '从本次输入消费到相关执行结束，包含排队、工具和人工等待';
    }
    if (usage.wallTimeBasis === 'request-span') {
      result.durationLabel = '请求区间用时 ' + usageDuration(usage.wallDurationMs);
      result.durationTitle = '仅辅助模型请求区间的并集，不代表完整回答或任务耗时';
    }
    if (usage.wallTimeBasis === 'observed-union') {
      result.durationLabel = '观测区间用时 ' + usageDuration(usage.wallDurationMs);
      result.durationTitle =
        '执行与辅助模型请求的已观测区间并集，重叠区间只计一次，不包含区间外空闲时间';
    }
  }
  if (usage.timedRequests > 0) {
    result.modelDurationLabel = usageDuration(usage.modelDurationMs);
    if (usage.unknownDurationRequests > 0) result.modelDurationLabel += '（部分）';
  }
  if (usage.timedQueueRequests > 0) {
    result.queueLabel = usageDuration(usage.queueDurationMs);
    if (usage.unknownQueueRequests > 0) result.queueLabel += '（部分）';
  }
  if (usage.timedToolCalls > 0 || usage.toolCalls === 0) {
    result.toolLabel = usageDuration(usage.toolDurationMs);
    if (usage.unknownToolDurationCalls > 0) result.toolLabel += '（部分）';
  }
  if (usage.unknownHumanWaits === 0) result.humanLabel = usageDuration(usage.humanWaitMs);
  else if (usage.humanWaitMs > 0) result.humanLabel = usageDuration(usage.humanWaitMs) + '（部分）';
  if (usage.estimatedCostUsd !== null && usage.estimatedRequests > 0) {
    let prefix = '模型估算 ';
    if (!usage.costComplete) prefix = '模型部分估算 ';
    result.costLabel = prefix + usageCost(usage.estimatedCostUsd);
    result.costTitle =
      '按每次请求保存的Pi模型目录费率与Usage估算，币种USD；' +
      '已估算 ' +
      usage.estimatedRequests +
      ' / ' +
      usage.requestCount +
      ' 次请求；外部服务费用另列，金额不代表供应商账单';
  }
  return result;
};

/** Detail rows expose independent measurements, including unknown timing segments. */
export const usageFacts = (usage: SessionUsage, text: UsageText): UsageFact[] => {
  return [
    { label: '已记录 Token', value: text.tokensLabel },
    { label: '执行时间', value: text.durationLabel },
    { label: '累计模型耗时', value: text.modelDurationLabel },
    {
      label: '模型计时完整度',
      value: usage.timedRequests + ' / ' + usage.requestCount + ' 次请求',
    },
    { label: '累计排队', value: text.queueLabel },
    {
      label: '排队计时完整度',
      value: usage.timedQueueRequests + ' / ' + usage.requestCount + ' 次请求',
    },
    { label: '累计工具执行', value: text.toolLabel },
    { label: '工具计时完整度', value: usage.timedToolCalls + ' / ' + usage.toolCalls + ' 次调用' },
    { label: '人工等待', value: text.humanLabel },
    { label: '未知人工等待', value: String(usage.unknownHumanWaits) + ' 段' },
    { label: '模型费用', value: text.costLabel },
  ];
};
