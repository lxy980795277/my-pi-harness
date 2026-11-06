import { type OAuthPhase, type OAuthFailureReason } from '@my-pi-harness/integrations';
import { PluginError } from '../plugins/errors';

const PHASE_LABELS: Record<OAuthPhase, string> = {
  'authorization-response': '校验授权回调失败',
  'token-exchange': '交换授权凭据失败',
  account: '读取授权账号失败',
};
const REASON_MESSAGES: Record<OAuthFailureReason, string> = {
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

/** Plugin API errors retain the public code and only safe provider diagnostics. */
export class PluginOAuthError extends PluginError {
  public readonly upstreamStatus?: number;
  public constructor(
    public readonly phase: OAuthPhase,
    public readonly reason: OAuthFailureReason,
    upstreamStatus?: number,
  ) {
    super('SKILL_OAUTH_FAILED', `${PHASE_LABELS[phase]}：${REASON_MESSAGES[reason]}`);
    this.name = 'PluginOAuthError';
    if (upstreamStatus !== undefined) this.upstreamStatus = upstreamStatus;
  }
}
