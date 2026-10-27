import type { Usage } from '@earendil-works/pi-ai';
import type { MessageUsage } from '@my-pi-harness/protocol';

/** Expose reported token counts; Pi's all-zero default cannot prove a provider supplied usage. */
export function messageUsage(usage: Usage): MessageUsage | undefined {
  if (
    usage.input === 0 &&
    usage.output === 0 &&
    usage.cacheRead === 0 &&
    usage.cacheWrite === 0 &&
    usage.totalTokens === 0
  ) {
    return undefined;
  }
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    totalTokens: usage.totalTokens,
  };
}
