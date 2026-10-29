import { RuntimeError } from '../errors.js';

export type RunFailure =
  | { kind: 'owned'; cause: unknown }
  | { kind: 'model'; message: string | undefined };

const UNKNOWN_FAILURE = '模型请求失败，请稍后重试。';

/** Provider text selects a fixed message; only application-owned RuntimeError text is public. */
export function runFailureMessage(failure: RunFailure): string {
  if (failure.kind === 'owned')
    return failure.cause instanceof RuntimeError ? failure.cause.message : UNKNOWN_FAILURE;
  const message = failure.message ?? '';
  if (/timed?\s*out|timeout|ETIMEDOUT/i.test(message)) return '模型请求超时，请稍后重试。';
  if (/\b(?:401|403)\b|invalid[_ -]?api[_ -]?key|authentication|unauthorized/i.test(message))
    return '模型服务认证失败，请检查 API Key 或授权状态。';
  if (/\b429\b|rate[_ -]?limit|too many requests/i.test(message))
    return '模型服务请求过于频繁，请稍后重试。';
  if (/\b5\d{2}\b|internal server error|service unavailable|overload|bad gateway/i.test(message))
    return '模型服务暂时不可用，请稍后重试。';
  if (
    /\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)\b|connection error|fetch failed|network error|socket hang up|failed to fetch/i.test(
      message,
    )
  )
    return '无法连接模型服务，请检查网络后重试。';
  return UNKNOWN_FAILURE;
}
