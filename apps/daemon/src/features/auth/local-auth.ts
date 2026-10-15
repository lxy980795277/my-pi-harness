import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthStatus } from '@my-pi-harness/protocol';
import type { FastifyRequest } from 'fastify';

const COOKIE = 'my_pi_session';
const SESSION_LIFETIME = 12 * 60 * 60 * 1000;
const PAIR_LIFETIME = 10 * 60 * 1000;
interface LocalSession {
  csrf: string;
  expiresAt: number;
}

/** Private daemon-owner bootstrap and browser pairing settings. */
export interface LocalAuthOptions {
  ownerSecret?: string;
  developmentOrigin?: string;
  githubConfigured: boolean;
}

function equalSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Owns application cookies; model provider credentials have separate ownership. */
export class LocalAuth {
  private readonly sessions = new Map<string, LocalSession>();
  private challenge = this.newChallenge();
  private attempts = { count: 0, until: 0 };
  private identity: AuthStatus['identity'] = null;

  public constructor(private readonly options: LocalAuthOptions) {}

  /** Private, user-visible pairing output is never a health or startup record. */
  public get pairingCode(): string {
    return this.challenge.code;
  }

  /** Check the actual listener Host and exact accepted browser Origin. */
  public trustedSource(request: FastifyRequest, requireOrigin: boolean): boolean {
    const address = request.server.server.address();
    if (address === null || typeof address === 'string') return false;
    const origin = `http://127.0.0.1:${address.port}`;
    const accepted = new Set([origin]);
    if (this.options.developmentOrigin) accepted.add(this.options.developmentOrigin);
    const host = request.headers.host;
    if (!host || ![...accepted].some((value) => new URL(value).host === host)) return false;
    const source = request.headers.origin;
    if (source === undefined) return !requireOrigin;
    return accepted.has(source);
  }

  public isAuthorized(request: FastifyRequest): boolean {
    return this.readSession(request) !== undefined;
  }

  public csrfValid(request: FastifyRequest): boolean {
    const session = this.readSession(request);
    const csrf = request.headers['x-csrf-token'];
    return session !== undefined && typeof csrf === 'string' && equalSecret(csrf, session.csrf);
  }

  public status(request: FastifyRequest): AuthStatus {
    const session = this.readSession(request);
    return {
      authenticated: session !== undefined,
      csrfToken: session?.csrf ?? null,
      githubConfigured: this.options.githubConfigured,
      identity: session ? this.identity : null,
    };
  }

  public pair(code: string): { cookie: string; csrfToken: string } {
    const now = Date.now();
    if (this.attempts.until < now) this.attempts = { count: 0, until: now + 60_000 };
    this.attempts.count += 1;
    if (this.attempts.count > 5) throw new Error('PAIR_RATE_LIMIT');
    if (now > this.challenge.expiresAt || !equalSecret(code, this.challenge.code))
      throw new Error('PAIR_INVALID');
    this.challenge = this.newChallenge();
    this.attempts = { count: 0, until: 0 };
    return this.grant();
  }

  public bootstrap(secret: string): string {
    if (!this.options.ownerSecret || !equalSecret(secret, this.options.ownerSecret))
      throw new Error('OWNER_INVALID');
    return this.grant().cookie;
  }

  /** Authorized owners renew an expired pairing challenge for another browser. */
  public getPairingCode(): string {
    if (this.challenge.expiresAt < Date.now()) this.challenge = this.newChallenge();
    return this.challenge.code;
  }

  public logout(request: FastifyRequest): void {
    const token = this.cookieToken(request);
    if (token) this.sessions.delete(token);
    this.identity = null;
  }

  public setIdentity(identity: NonNullable<AuthStatus['identity']>): void {
    this.identity = identity;
  }
  public close(): void {
    this.sessions.clear();
    this.identity = null;
  }
  public clearCookie(): string {
    return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0`;
  }

  private grant(): { cookie: string; csrfToken: string } {
    for (const [id, session] of this.sessions)
      if (session.expiresAt < Date.now()) this.sessions.delete(id);
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(32).toString('base64url');
    this.sessions.set(token, { csrf, expiresAt: Date.now() + SESSION_LIFETIME });
    return {
      cookie: `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${SESSION_LIFETIME / 1000}`,
      csrfToken: csrf,
    };
  }
  private newChallenge(): { code: string; expiresAt: number } {
    return { code: randomBytes(8).toString('hex'), expiresAt: Date.now() + PAIR_LIFETIME };
  }
  private cookieToken(request: FastifyRequest): string | undefined {
    const values = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${COOKIE}=`));
    if (!values || values.length !== 1) return undefined;
    return values[0]?.slice(COOKIE.length + 1);
  }
  private readSession(request: FastifyRequest): LocalSession | undefined {
    const token = this.cookieToken(request);
    if (!token) return undefined;
    const session = this.sessions.get(token);
    if (session && session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return undefined;
    }
    return session;
  }
}
