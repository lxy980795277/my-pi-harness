import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AuthStatus, LoginProvider } from '@my-pi-harness/protocol';
import type {
  AuthRepository,
  LocalClient,
  StoredLoginSession,
  VerifiedIdentity,
} from '@my-pi-harness/storage';
import type { FastifyRequest } from 'fastify';
import { LoginError } from './errors.js';

const LOCAL_COOKIE = 'my_pi_local';
const LOGIN_COOKIE = 'my_pi_session';
const CLIENT_LIFETIME = 90 * 24 * 60 * 60 * 1000;
const SESSION_LIFETIME = 30 * 24 * 60 * 60 * 1000;
const PAIR_LIFETIME = 10 * 60 * 1000;

/** Private bootstrap and persistent application authorization for one local profile. */
export interface LocalAuthOptions {
  store: AuthRepository;
  providers: () => LoginProvider[];
  ownerSecret?: string;
  developmentOrigin?: string;
  callbackOrigin?: string;
  pluginCallbackUrls?: readonly string[];
}

function equalSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Checks local client trust and separately issued, client-bound application sessions. */
export class LocalAuth {
  private challenge = this.newChallenge();
  private attempts = { count: 0, until: 0 };
  private readonly watchers = new Map<() => void, () => void>();

  public constructor(private readonly options: LocalAuthOptions) {}

  public get pairingCode(): string {
    return this.challenge.code;
  }

  public trustedSource(request: FastifyRequest, requireOrigin: boolean): boolean {
    const address = request.server.server.address();
    if (address === null || typeof address === 'string') return false;
    const accepted = new Set([`http://127.0.0.1:${address.port}`]);
    if (this.options.developmentOrigin) accepted.add(this.options.developmentOrigin);
    if (this.options.callbackOrigin) accepted.add(this.options.callbackOrigin);
    if (request.method === 'GET') {
      const path = request.url.split('?')[0];
      for (const callback of this.options.pluginCallbackUrls ?? []) {
        const url = new URL(callback);
        if (path === url.pathname) accepted.add(url.origin);
      }
    }
    const host = request.headers.host;
    if (!host || ![...accepted].some((value) => new URL(value).host === host)) return false;
    const source = request.headers.origin;
    if (source === undefined) return !requireOrigin;
    return accepted.has(source);
  }

  /** Called after source validation; no forwarding headers select the login return origin. */
  public applicationOrigin(request: FastifyRequest): string {
    if (request.headers.origin) return request.headers.origin;
    return `http://${request.headers.host}`;
  }

  public client(request: FastifyRequest): LocalClient | undefined {
    const token = this.cookieToken(request, LOCAL_COOKIE);
    if (token === undefined) return undefined;
    return this.options.store.findLocalClient(hash(token), Date.now());
  }

  public requireClient(request: FastifyRequest): LocalClient {
    const client = this.client(request);
    if (!client) throw new LoginError('LOCAL_AUTH_REQUIRED', '请先完成本机授权。', 401);
    return client;
  }

  public isAuthorized(request: FastifyRequest): boolean {
    return this.session(request) !== undefined;
  }

  public csrfValid(request: FastifyRequest): boolean {
    const client = this.client(request);
    const csrf = request.headers['x-csrf-token'];
    return client !== undefined && typeof csrf === 'string' && equalSecret(csrf, client.csrfToken);
  }

  public status(request: FastifyRequest): AuthStatus {
    const client = this.client(request);
    const session = this.session(request);
    return this.describe(client, session);
  }

  private describe(
    client: LocalClient | undefined,
    session: StoredLoginSession | undefined,
  ): AuthStatus {
    let sessionInfo: AuthStatus['session'] = null;
    if (session)
      sessionInfo = {
        id: session.id,
        providerId: session.providerId,
        expiresAt: session.expiresAt,
      };
    return {
      localAuthorized: client !== undefined,
      authenticated: session !== undefined,
      csrfToken: client?.csrfToken ?? null,
      providers: this.options.providers(),
      profileBound: this.options.store.profileOwner() !== undefined,
      user: session?.user ?? null,
      session: sessionInfo,
    };
  }

  public pair(code: string): { cookie: string; status: AuthStatus } {
    const now = Date.now();
    if (this.attempts.until < now) this.attempts = { count: 0, until: now + 60_000 };
    this.attempts.count += 1;
    if (this.attempts.count > 5)
      throw new LoginError('PAIR_RATE_LIMIT', '尝试次数过多，请稍后再试。', 429);
    if (now > this.challenge.expiresAt || !equalSecret(code, this.challenge.code))
      throw new LoginError('PAIR_INVALID', '配对码无效或已过期。', 401);
    const grant = this.grant();
    this.challenge = this.newChallenge();
    this.attempts = { count: 0, until: 0 };
    return { cookie: grant.cookie, status: this.describe(grant.client, undefined) };
  }

  public bootstrap(secret: string, request: FastifyRequest): string {
    if (!this.options.ownerSecret || !equalSecret(secret, this.options.ownerSecret))
      throw new LoginError('OWNER_INVALID', '桌面授权失败。', 401);
    const token = this.cookieToken(request, LOCAL_COOKIE);
    const client = this.client(request);
    if (token && client) return cookieValue(LOCAL_COOKIE, token, client.expiresAt);
    return this.grant().cookie;
  }

  public getPairingCode(): string {
    if (this.challenge.expiresAt < Date.now()) this.challenge = this.newChallenge();
    return this.challenge.code;
  }

  public login(
    request: FastifyRequest,
    identity: VerifiedIdentity,
  ): { cookie: string; status: AuthStatus } {
    const client = this.requireClient(request);
    const token = randomBytes(32).toString('base64url');
    const createdAt = Date.now();
    const session = this.options.store.completeLogin(identity, client.id, {
      id: randomUUID(),
      tokenHash: hash(token),
      createdAt,
      expiresAt: Math.min(createdAt + SESSION_LIFETIME, client.expiresAt),
    });
    return {
      cookie: cookieValue(LOGIN_COOKIE, token, session.expiresAt),
      status: this.describe(client, session),
    };
  }

  public logout(request: FastifyRequest): void {
    this.options.store.revokeClientSessions(this.requireClient(request).id);
    for (const notify of this.watchers.keys()) notify();
  }

  /** Observe revocation immediately and expiry without waiting for another business event. */
  public watch(request: FastifyRequest, onLost: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const stop = (): void => {
      closed = true;
      this.watchers.delete(inspect);
      clearTimeout(timer);
    };
    const inspect = (): void => {
      if (closed) return;
      clearTimeout(timer);
      const session = this.session(request);
      if (session === undefined) {
        stop();
        onLost();
        return;
      }
      timer = setTimeout(
        inspect,
        Math.min(session.expiresAt - Date.now() + 1, 24 * 60 * 60 * 1000),
      );
      timer.unref();
    };
    this.watchers.set(inspect, stop);
    inspect();
    return stop;
  }

  public clearLoginCookie(): string {
    return `${LOGIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0`;
  }

  public close(): void {
    for (const stop of this.watchers.values()) stop();
  }

  private grant(): { cookie: string; client: LocalClient } {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const client = this.options.store.createLocalClient({
      id: randomUUID(),
      tokenHash: hash(token),
      csrfToken: randomBytes(32).toString('base64url'),
      createdAt: now,
      expiresAt: now + CLIENT_LIFETIME,
    });
    return { cookie: cookieValue(LOCAL_COOKIE, token, client.expiresAt), client };
  }

  private session(request: FastifyRequest): StoredLoginSession | undefined {
    const client = this.client(request);
    const token = this.cookieToken(request, LOGIN_COOKIE);
    if (!client || !token) return undefined;
    return this.options.store.findLoginSession(hash(token), client.id, Date.now());
  }

  private newChallenge(): { code: string; expiresAt: number } {
    return { code: randomBytes(8).toString('hex'), expiresAt: Date.now() + PAIR_LIFETIME };
  }

  private cookieToken(request: FastifyRequest, name: string): string | undefined {
    const values = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${name}=`));
    if (!values || values.length !== 1) return undefined;
    const token = values[0]?.slice(name.length + 1);
    if (token === undefined || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    return token;
  }
}

function cookieValue(name: string, token: string, expiresAt: number): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return `${name}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}`;
}
