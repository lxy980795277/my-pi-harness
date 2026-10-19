import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomBytes } from 'node:crypto';
import type { VerifiedIdentity } from '@my-pi-harness/storage';
import type { LoginMethod } from '@my-pi-harness/protocol';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type {
  IdentityChallenge,
  IdentityProvider,
  WebIdentityChallenge,
} from './identity-provider.js';
import { LoginError } from './errors.js';

const DeviceSchema = Type.Object({
  device_code: Type.String({ minLength: 1, maxLength: 1024 }),
  user_code: Type.String({ minLength: 1, maxLength: 64 }),
  verification_uri: Type.String({ maxLength: 2048 }),
  expires_in: Type.Integer({ minimum: 1, maximum: 1800 }),
  interval: Type.Integer({ minimum: 1, maximum: 60 }),
});
const TokenSchema = Type.Object({
  access_token: Type.Optional(Type.String({ minLength: 1, maxLength: 16_384 })),
  error: Type.Optional(Type.String({ maxLength: 128 })),
  interval: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600 })),
});
const IdentitySchema = Type.Object({
  id: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  login: Type.String({ minLength: 1, maxLength: 200 }),
  name: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
  avatar_url: Type.String({ maxLength: 2048 }),
});

/** GitHub.com device and PKCE code grants; tokens live only through the identity request. */
export class GitHubIdentityProvider implements IdentityProvider {
  public readonly id = 'github';
  public readonly name = 'GitHub';
  public readonly available: boolean;
  public readonly methods: readonly LoginMethod[];

  public constructor(
    private readonly clientId: string | null,
    private readonly request: typeof fetch = fetch,
    private readonly clientSecret: string | null = null,
  ) {
    this.available = clientId !== null;
    this.methods = [];
    if (this.available) this.methods = ['device'];
    if (this.available && clientSecret !== null) this.methods = ['device', 'web'];
  }

  public beginWeb(callbackUrl: string, state: string, signal: AbortSignal): WebIdentityChallenge {
    signal.throwIfAborted();
    if (!this.clientId || !this.clientSecret)
      throw new LoginError('LOGIN_WEB_NOT_CONFIGURED', '浏览器登录尚未配置 GitHub Client Secret。');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const clientId = this.clientId;
    const secret = this.clientSecret;
    const url = new URL('https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      scope: 'read:user',
      prompt: 'select_account',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return {
      url: url.href,
      authorizationIssuer: 'https://github.com/login/oauth',
      expiresAt: Date.now() + 10 * 60 * 1000,
      complete: async (code, ownerSignal) => {
        const token = await this.post(
          'https://github.com/login/oauth/access_token',
          {
            client_id: clientId,
            client_secret: secret,
            code,
            redirect_uri: callbackUrl,
            code_verifier: verifier,
          },
          ownerSignal,
        );
        if (!Value.Check(TokenSchema, token) || !token.access_token) {
          if (Value.Check(TokenSchema, token) && token.error === 'bad_verification_code')
            throw new LoginError('LOGIN_CODE_INVALID', 'GitHub 授权码无效或已过期，请重试。');
          throw invalidResponse();
        }
        return this.identify(token.access_token, ownerSignal);
      },
    };
  }

  public async begin(signal: AbortSignal): Promise<IdentityChallenge> {
    if (!this.clientId)
      throw new LoginError('LOGIN_NOT_CONFIGURED', '尚未配置 GitHub 应用 Client ID。');
    const device = await this.post(
      'https://github.com/login/device/code',
      { client_id: this.clientId, scope: 'read:user' },
      signal,
    );
    if (!Value.Check(DeviceSchema, device)) throw invalidResponse();
    const verification = new URL(device.verification_uri);
    if (
      verification.origin !== 'https://github.com' ||
      verification.pathname !== '/login/device' ||
      verification.username ||
      verification.password ||
      verification.search ||
      verification.hash
    )
      throw invalidResponse();
    const expiresAt = Date.now() + device.expires_in * 1000;
    const clientId = this.clientId;
    return {
      url: verification.href,
      userCode: device.user_code,
      expiresAt,
      verify: async (ownerSignal): Promise<VerifiedIdentity> => {
        const remaining = Math.max(1, expiresAt - Date.now());
        const lifetime = AbortSignal.any([ownerSignal, AbortSignal.timeout(remaining)]);
        let interval = device.interval;
        while (Date.now() < expiresAt) {
          await delay(interval * 1000, undefined, { signal: lifetime });
          if (Date.now() >= expiresAt)
            throw new LoginError('LOGIN_EXPIRED', 'GitHub 授权已过期，请重试。');
          const token = await this.post(
            'https://github.com/login/oauth/access_token',
            {
              client_id: clientId,
              device_code: device.device_code,
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            },
            lifetime,
          );
          if (!Value.Check(TokenSchema, token)) throw invalidResponse();
          if (token.access_token) return this.identify(token.access_token, lifetime);
          if (token.error === 'slow_down') {
            interval += 5;
            if (token.interval !== undefined) interval = Math.max(interval, token.interval);
            continue;
          }
          if (token.error === 'authorization_pending') continue;
          if (token.error === 'access_denied')
            throw new LoginError('LOGIN_DENIED', 'GitHub 授权已被拒绝，请重试。');
          if (token.error === 'expired_token')
            throw new LoginError('LOGIN_EXPIRED', 'GitHub 授权已过期，请重试。');
          throw invalidResponse();
        }
        throw new LoginError('LOGIN_EXPIRED', 'GitHub 授权已过期，请重试。');
      },
    };
  }

  private async identify(token: string, signal: AbortSignal): Promise<VerifiedIdentity> {
    const value = await this.json('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'my-pi-harness',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal,
    });
    if (!Value.Check(IdentitySchema, value)) throw invalidResponse();
    const avatar = new URL(value.avatar_url);
    if (
      avatar.origin !== 'https://avatars.githubusercontent.com' ||
      avatar.username ||
      avatar.password
    )
      throw invalidResponse();
    signal.throwIfAborted();
    let name = value.login;
    if (value.name?.trim()) name = value.name.trim();
    return {
      providerId: this.id,
      issuer: 'https://github.com',
      subject: String(value.id),
      name,
      avatarUrl: avatar.href,
    };
  }

  private async post(
    url: string,
    fields: Record<string, string>,
    signal: AbortSignal,
  ): Promise<unknown> {
    return this.json(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
      signal,
    });
  }

  private async json(url: string, init: RequestInit & { signal: AbortSignal }): Promise<unknown> {
    const signal = AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]);
    const response = await this.request(url, { ...init, signal, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel();
      throw new LoginError('LOGIN_UPSTREAM_FAILED', 'GitHub 暂时不可用，请稍后重试。', 502);
    }
    const reader = response.body?.getReader();
    if (!reader) throw invalidResponse();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const part: { done: boolean; value?: unknown } = await reader.read();
        signal.throwIfAborted();
        if (part.done) break;
        if (!(part.value instanceof Uint8Array)) throw invalidResponse();
        length += part.value.byteLength;
        if (length > 64 * 1024) throw invalidResponse();
        chunks.push(part.value);
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        throw invalidResponse();
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
}

function invalidResponse(): LoginError {
  return new LoginError('LOGIN_RESPONSE_INVALID', 'GitHub 返回的授权或身份信息无效。', 502);
}
