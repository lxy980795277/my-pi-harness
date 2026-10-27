import { SkillError } from '../skills/errors.js';
import { McpError } from '../errors.js';

export type PluginOAuthPhase = 'authorization-response' | 'token-exchange' | 'account';
export type PluginOAuthFailureReason =
  | 'invalid-state'
  | 'issuer-mismatch'
  | 'access-denied'
  | 'client-unconfigured'
  | 'incorrect-client-credentials'
  | 'redirect-uri-mismatch'
  | 'bad-verification-code'
  | 'unverified-user-email'
  | 'provider-error'
  | 'dns-failed'
  | 'private-network'
  | 'network-failed'
  | 'cancelled'
  | 'timeout'
  | 'upstream-http'
  | 'invalid-json'
  | 'invalid-response';

const PHASE_LABELS: Record<PluginOAuthPhase, string> = {
  'authorization-response': '校验授权回调失败',
  'token-exchange': '交换授权凭据失败',
  account: '读取授权账号失败',
};
const REASON_MESSAGES: Record<PluginOAuthFailureReason, string> = {
  'invalid-state': '授权请求已失效或与当前流程不匹配，请重新授权。',
  'issuer-mismatch': '授权响应的发行者与插件配置不一致。',
  'access-denied': '用户或服务拒绝了授权。',
  'client-unconfigured': '尚未配置插件 OAuth 客户端。',
  'incorrect-client-credentials': '请检查插件 Client ID 与 Client Secret 是否属于同一 OAuth App。',
  'redirect-uri-mismatch': 'OAuth 回调地址与服务端注册不一致。',
  'bad-verification-code': '授权码无效或已过期，请重新授权。',
  'unverified-user-email': '请先在服务中验证账号邮箱，再重新授权。',
  'provider-error': '授权服务拒绝了此次请求，请重新授权或检查配置。',
  'dns-failed': '无法解析授权服务地址，请检查网络后重试。',
  'private-network': '授权服务解析到了被禁止的网络地址。',
  'network-failed': '无法连接授权服务，请检查网络后重试。',
  cancelled: '授权请求已取消。',
  timeout: '授权服务响应超时，请稍后重试。',
  'upstream-http': '授权服务返回了失败状态，请稍后重试。',
  'invalid-json': '授权服务返回了无效 JSON。',
  'invalid-response': '授权服务返回了不符合要求的数据。',
};

/** Safe diagnostics contain only owned labels, finite categories and an optional HTTP status. */
export class PluginOAuthError extends SkillError {
  public readonly upstreamStatus?: number;
  public constructor(
    public readonly phase: PluginOAuthPhase,
    public readonly reason: PluginOAuthFailureReason,
    upstreamStatus?: number,
  ) {
    super('SKILL_OAUTH_FAILED', `${PHASE_LABELS[phase]}：${REASON_MESSAGES[reason]}`);
    this.name = 'PluginOAuthError';
    if (upstreamStatus !== undefined) this.upstreamStatus = upstreamStatus;
  }
}

/** Provider strings are reduced to a fixed allowlist; descriptions and unknown strings are discarded. */
export function pluginOAuthProviderFailure(error: unknown): PluginOAuthFailureReason {
  switch (error) {
    case 'access_denied':
      return 'access-denied';
    case 'incorrect_client_credentials':
      return 'incorrect-client-credentials';
    case 'redirect_uri_mismatch':
      return 'redirect-uri-mismatch';
    case 'bad_verification_code':
      return 'bad-verification-code';
    case 'unverified_user_email':
      return 'unverified-user-email';
    default:
      return 'provider-error';
  }
}

/** Raw transport messages and causes never become OAuth error properties. */
export function pluginOAuthNetworkFailure(
  phase: PluginOAuthPhase,
  error: unknown,
  signal: AbortSignal,
  upstreamStatus?: number,
): PluginOAuthError {
  if (signal.aborted) {
    const reason: unknown = signal.reason;
    if (reason instanceof DOMException && reason.name === 'TimeoutError')
      return new PluginOAuthError(phase, 'timeout', upstreamStatus);
    return new PluginOAuthError(phase, 'cancelled', upstreamStatus);
  }
  if (error instanceof DOMException && error.name === 'TimeoutError')
    return new PluginOAuthError(phase, 'timeout', upstreamStatus);
  if (error instanceof DOMException && error.name === 'AbortError')
    return new PluginOAuthError(phase, 'cancelled', upstreamStatus);
  if (error instanceof McpError) {
    switch (error.code) {
      case 'DNS_FAILED':
        return new PluginOAuthError(phase, 'dns-failed', upstreamStatus);
      case 'PRIVATE_NETWORK':
        return new PluginOAuthError(phase, 'private-network', upstreamStatus);
      case 'CANCELLED':
        return new PluginOAuthError(phase, 'cancelled', upstreamStatus);
      case 'RESPONSE_LIMIT':
      case 'INVALID_RESPONSE':
      case 'ENCODING_FORBIDDEN':
      case 'REDIRECT_FORBIDDEN':
        return new PluginOAuthError(phase, 'invalid-response', upstreamStatus);
    }
  }
  return new PluginOAuthError(phase, 'network-failed', upstreamStatus);
}
