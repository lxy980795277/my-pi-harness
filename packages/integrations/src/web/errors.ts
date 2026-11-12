import { SandboxError } from '@my-pi-harness/sandbox/network';
import { NetworkError } from '../network/errors';

export type WebServiceErrorCode =
  | 'WEB_INVALID_URL'
  | 'WEB_PRIVATE_NETWORK'
  | 'WEB_DNS_FAILED'
  | 'WEB_CANCELLED'
  | 'WEB_TIMEOUT'
  | 'WEB_NETWORK_FAILED'
  | 'WEB_INVALID_RESPONSE'
  | 'WEB_RESPONSE_LIMIT'
  | 'WEB_AUTH_FAILED'
  | 'WEB_BALANCE_REQUIRED'
  | 'WEB_FORBIDDEN'
  | 'WEB_NOT_FOUND'
  | 'WEB_RATE_LIMITED'
  | 'WEB_UPSTREAM_FAILED';

/** Public diagnostics contain fixed owned messages, never provider bodies, credentials or causes. */
export class WebServiceError extends Error {
  public readonly upstreamStatus?: number;

  public constructor(
    public readonly code: WebServiceErrorCode,
    message: string,
    upstreamStatus?: number,
  ) {
    super(message);
    this.name = 'WebServiceError';
    if (upstreamStatus !== undefined) this.upstreamStatus = upstreamStatus;
  }
}

/** HTTP failures do not trigger automatic retries or credential changes. */
export function webHttpFailure(status: number): WebServiceError {
  switch (status) {
    case 401:
      return new WebServiceError(
        'WEB_AUTH_FAILED',
        'DeepSeek 联网服务 Key 无效，请在设置中更新。',
        status,
      );
    case 402:
      return new WebServiceError('WEB_BALANCE_REQUIRED', 'DeepSeek 联网服务余额不足。', status);
    case 403:
      return new WebServiceError('WEB_FORBIDDEN', 'DeepSeek 联网服务拒绝访问此页面。', status);
    case 404:
      return new WebServiceError('WEB_NOT_FOUND', 'DeepSeek 未能读取此页面的正文。', status);
    case 408:
    case 504:
      return new WebServiceError('WEB_TIMEOUT', 'DeepSeek 联网请求超时，请稍后重试。', status);
    case 413:
      return new WebServiceError(
        'WEB_RESPONSE_LIMIT',
        'DeepSeek 联网请求或页面超过大小限制。',
        status,
      );
    case 429:
      return new WebServiceError(
        'WEB_RATE_LIMITED',
        'DeepSeek 联网服务请求过于频繁，请稍后重试。',
        status,
      );
    default:
      return new WebServiceError('WEB_UPSTREAM_FAILED', 'DeepSeek 联网服务请求失败。', status);
  }
}

/** Transport failures retain safe categories without copying their raw message. */
export function webNetworkFailure(error: unknown, signal: AbortSignal): WebServiceError {
  if (signal.aborted) {
    if (signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError')
      return new WebServiceError('WEB_TIMEOUT', 'DeepSeek 联网请求超时。');
    return new WebServiceError('WEB_CANCELLED', '联网请求已取消。');
  }
  if (error instanceof WebServiceError) return error;
  if (error instanceof SandboxError && error.code === 'DNS_FAILED')
    return new WebServiceError('WEB_DNS_FAILED', '页面地址解析失败。');
  if (error instanceof NetworkError) {
    switch (error.code) {
      case 'PRIVATE_NETWORK':
        return new WebServiceError('WEB_PRIVATE_NETWORK', '联网服务不能访问本机或私有网络地址。');
      case 'DNS_FAILED':
        return new WebServiceError('WEB_DNS_FAILED', 'DeepSeek 服务地址解析失败。');
      case 'RESPONSE_LIMIT':
        return new WebServiceError('WEB_RESPONSE_LIMIT', 'DeepSeek 联网响应超过大小限制。');
      case 'ENCODING_FORBIDDEN':
      case 'REDIRECT_FORBIDDEN':
      case 'INVALID_RESPONSE':
        return new WebServiceError('WEB_INVALID_RESPONSE', 'DeepSeek 联网服务返回了无效数据。');
    }
  }
  return new WebServiceError('WEB_NETWORK_FAILED', 'DeepSeek 联网连接中断，请稍后重试。');
}
