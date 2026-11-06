import { NetworkError } from '../network/errors';

export type OAuthPhase = 'authorization-response' | 'token-exchange' | 'account';
export type OAuthFailureReason =
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

/** Safe diagnostics contain only owned labels, finite categories and an optional HTTP status. */
export class OAuthError extends Error {
  public readonly upstreamStatus?: number;
  public constructor(
    public readonly phase: OAuthPhase,
    public readonly reason: OAuthFailureReason,
    upstreamStatus?: number,
  ) {
    super(`OAuth ${phase} failed: ${reason}`);
    this.name = 'OAuthError';
    if (upstreamStatus !== undefined) this.upstreamStatus = upstreamStatus;
  }
}

/** Provider strings are reduced to a fixed allowlist; descriptions and unknown strings are discarded. */
export function oauthProviderFailure(error: unknown): OAuthFailureReason {
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
export function oauthNetworkFailure(
  phase: OAuthPhase,
  error: unknown,
  signal: AbortSignal,
  upstreamStatus?: number,
): OAuthError {
  if (signal.aborted) {
    const reason: unknown = signal.reason;
    if (reason instanceof DOMException && reason.name === 'TimeoutError')
      return new OAuthError(phase, 'timeout', upstreamStatus);
    return new OAuthError(phase, 'cancelled', upstreamStatus);
  }
  if (error instanceof DOMException && error.name === 'TimeoutError')
    return new OAuthError(phase, 'timeout', upstreamStatus);
  if (error instanceof DOMException && error.name === 'AbortError')
    return new OAuthError(phase, 'cancelled', upstreamStatus);
  if (error instanceof NetworkError) {
    switch (error.code) {
      case 'DNS_FAILED':
        return new OAuthError(phase, 'dns-failed', upstreamStatus);
      case 'PRIVATE_NETWORK':
        return new OAuthError(phase, 'private-network', upstreamStatus);
      case 'CANCELLED':
        return new OAuthError(phase, 'cancelled', upstreamStatus);
      case 'RESPONSE_LIMIT':
      case 'INVALID_RESPONSE':
      case 'ENCODING_FORBIDDEN':
      case 'REDIRECT_FORBIDDEN':
        return new OAuthError(phase, 'invalid-response', upstreamStatus);
    }
  }
  return new OAuthError(phase, 'network-failed', upstreamStatus);
}

/** A refresh grant can no longer authorize requests; callers invalidate their owned account. */
export class OAuthRefreshRequiredError extends Error {
  public constructor() {
    super('服务授权已失效，请重新授权。');
    this.name = 'OAuthRefreshRequiredError';
  }
}
