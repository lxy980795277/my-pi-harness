import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { LoginFlow, LoginMethod, LoginProvider } from '@my-pi-harness/protocol';
import type { VerifiedIdentity } from '@my-pi-harness/storage';
import type {
  IdentityChallenge,
  IdentityProvider,
  WebIdentityChallenge,
} from './identity-provider.js';
import { LoginError } from './errors.js';

interface PendingLogin {
  clientId: string;
  flow: LoginFlow;
  controller: AbortController;
  task: Promise<void>;
  identity?: VerifiedIdentity;
  consumed: boolean;
  method: LoginMethod;
  web?: {
    state: string;
    nonceHash: string;
    challenge: WebIdentityChallenge;
    returnOrigin: string;
    callbackUsed: boolean;
  };
}

const CALLBACK_COOKIE = 'my_pi_login_callback';
const CALLBACK_PATH = '/api/auth/callback';

/** Callback proof is separate from Strict local/application cookies. */
export function clearLoginCallbackCookie(): string {
  return `${CALLBACK_COOKIE}=; HttpOnly; SameSite=Lax; Path=${CALLBACK_PATH}; Max-Age=0`;
}

/** Extract one bounded callback nonce; duplicate cookies are rejected. */
export function loginCallbackNonce(cookie: string | undefined): string | undefined {
  const matches = cookie
    ?.split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${CALLBACK_COOKIE}=`));
  if (matches?.length !== 1) return undefined;
  const value = matches[0]?.slice(CALLBACK_COOKIE.length + 1);
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return undefined;
  return value;
}

/** Owns temporary client-bound verification; durable account/session changes belong to storage. */
export class LoginService {
  private readonly providers = new Map<string, IdentityProvider>();
  private readonly flows = new Map<string, PendingLogin>();
  private readonly activeTasks = new Map<PendingLogin, Promise<void>>();
  private closed = false;

  public constructor(providers: readonly IdentityProvider[]) {
    for (const provider of providers) {
      if (this.providers.has(provider.id)) throw new Error('Duplicate identity provider');
      this.providers.set(provider.id, provider);
    }
  }

  public listProviders(): LoginProvider[] {
    return [...this.providers.values()].map(({ id, name, available, methods }) => ({
      id,
      name,
      available,
      methods: [...methods],
    }));
  }

  public async start(clientId: string, providerId: string): Promise<LoginFlow> {
    if (this.closed) throw new LoginError('LOGIN_CLOSED', '登录服务正在关闭。', 503);
    const provider = this.providers.get(providerId);
    if (!provider?.available) throw new LoginError('LOGIN_NOT_CONFIGURED', '该登录方式尚未配置。');
    if (!provider.methods.includes('device') || !provider.begin)
      throw new LoginError('LOGIN_METHOD_UNAVAILABLE', '该登录方式不支持设备授权。');
    const record = this.reserve(clientId, providerId, 'device');
    const starting = provider.begin(record.controller.signal);
    record.task = this.verify(record, starting);
    this.activeTasks.set(record, record.task);
    try {
      await starting;
      record.controller.signal.throwIfAborted();
      return structuredClone(record.flow);
    } catch (error: unknown) {
      if (error instanceof LoginError) throw error;
      throw new LoginError('LOGIN_START_FAILED', '无法开始登录，请重试。', 502);
    }
  }

  public async startWeb(
    clientId: string,
    providerId: string,
    callbackUrl: string,
    returnOrigin: string,
  ): Promise<{ flow: LoginFlow; cookie: string }> {
    if (this.closed) throw new LoginError('LOGIN_CLOSED', '登录服务正在关闭。', 503);
    const provider = this.providers.get(providerId);
    if (!provider?.available) throw new LoginError('LOGIN_NOT_CONFIGURED', '该登录方式尚未配置。');
    if (!provider.methods.includes('web') || !provider.beginWeb)
      throw new LoginError('LOGIN_WEB_NOT_CONFIGURED', '浏览器登录尚未配置，请检查应用授权配置。');
    if (new URL(callbackUrl).hostname !== new URL(returnOrigin).hostname)
      throw new LoginError(
        'LOGIN_CALLBACK_CONFIG_INVALID',
        '登录回调地址与工作台必须使用相同的主机名，请检查回调配置。',
      );
    const previous = [...this.flows.values()].filter(
      (candidate) =>
        candidate.clientId === clientId &&
        candidate.method === 'web' &&
        candidate.flow.status === 'pending',
    );
    for (const record of previous) this.stop(record);
    const record = this.reserve(clientId, providerId, 'web');
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    record.task = this.prepareWeb(
      record,
      provider,
      callbackUrl,
      returnOrigin,
      state,
      nonce,
      previous,
    );
    this.activeTasks.set(record, record.task);
    await record.task;
    if (this.closed) throw new LoginError('LOGIN_CLOSED', '登录服务正在关闭。', 503);
    if (record.controller.signal.aborted)
      throw new LoginError('LOGIN_CANCELLED', '登录已取消，请重新登录。');
    if (!record.web || record.flow.status !== 'pending')
      throw new LoginError('LOGIN_START_FAILED', '无法开始浏览器登录，请重试。', 502);
    const maxAge = Math.max(0, Math.floor((record.flow.expiresAt - Date.now()) / 1000));
    return {
      flow: structuredClone(record.flow),
      cookie: `${CALLBACK_COOKIE}=${nonce}; HttpOnly; SameSite=Lax; Path=${CALLBACK_PATH}; Max-Age=${maxAge}`,
    };
  }

  /** State is consumed before exchange. A callback cannot authenticate another browser. */
  public async completeWeb(
    providerId: string,
    state: string,
    nonce: string | undefined,
    code: string | undefined,
    error: string | undefined,
    issuer?: string,
  ): Promise<string> {
    const record = [...this.flows.values()].find(
      (candidate) => candidate.web?.state === state && candidate.flow.providerId === providerId,
    );
    const web = record?.web;
    if (!record || !web || !nonce || !equalNonce(nonce, web.nonceHash))
      throw new LoginError('LOGIN_CALLBACK_INVALID', '登录回调无效，请重新登录。', 400);
    if (
      this.closed ||
      web.callbackUsed ||
      record.consumed ||
      record.controller.signal.aborted ||
      record.flow.status !== 'pending'
    )
      throw new LoginError('LOGIN_CALLBACK_USED', '登录回调已使用或取消，请重新登录。');
    if (issuer !== undefined && issuer !== web.challenge.authorizationIssuer)
      throw new LoginError('LOGIN_ISSUER_MISMATCH', '登录授权来源不一致，请重新登录。', 400);
    web.callbackUsed = true;
    this.require(record.clientId, record.flow.id);
    if (error !== undefined || code === undefined) {
      record.flow.status = 'failed';
      record.flow.error = '授权未完成，请重新尝试。';
      if (error === 'access_denied') record.flow.error = '授权已被拒绝，请重试。';
    } else {
      record.task = this.verifyWeb(record, web.challenge, code);
      this.activeTasks.set(record, record.task);
      await record.task;
    }
    const target = new URL('/', web.returnOrigin);
    target.searchParams.set('login_flow', record.flow.id);
    return target.href;
  }

  private reserve(clientId: string, providerId: string, method: LoginMethod): PendingLogin {
    if (this.closed) throw new LoginError('LOGIN_CLOSED', '登录服务正在关闭。', 503);
    for (const [id, record] of this.flows) {
      if (
        record.flow.expiresAt <= Date.now() ||
        record.consumed ||
        ['failed', 'cancelled'].includes(record.flow.status)
      ) {
        record.controller.abort();
        delete record.identity;
        this.flows.delete(id);
      }
    }
    for (const record of this.flows.values())
      if (record.clientId === clientId && record.flow.status === 'pending')
        throw new LoginError('LOGIN_BUSY', '已有登录正在进行，请先取消。');
    if (this.flows.size >= 32)
      throw new LoginError('LOGIN_LIMIT', '登录请求过多，请稍后重试。', 429);
    const controller = new AbortController();
    const record: PendingLogin = {
      clientId,
      controller,
      task: Promise.resolve(),
      consumed: false,
      method,
      flow: {
        id: `login_${randomUUID()}`,
        providerId,
        status: 'pending',
        url: null,
        deviceCode: null,
        expiresAt: Date.now() + 60_000,
        error: null,
      },
    };
    this.flows.set(record.flow.id, record);
    return record;
  }

  private async prepareWeb(
    record: PendingLogin,
    provider: IdentityProvider,
    callbackUrl: string,
    returnOrigin: string,
    state: string,
    nonce: string,
    previous: readonly PendingLogin[],
  ): Promise<void> {
    try {
      await Promise.all(previous.map((pending) => pending.task));
      record.controller.signal.throwIfAborted();
      if (this.closed) throw new LoginError('LOGIN_CLOSED', '登录服务正在关闭。', 503);
      if (!provider.beginWeb)
        throw new LoginError('LOGIN_METHOD_UNAVAILABLE', '不支持浏览器登录。');
      const challenge = await provider.beginWeb(callbackUrl, state, record.controller.signal);
      record.controller.signal.throwIfAborted();
      if (this.closed || record.consumed) return;
      record.flow.url = challenge.url;
      record.flow.expiresAt = challenge.expiresAt;
      record.web = {
        state,
        nonceHash: hashNonce(nonce),
        challenge,
        returnOrigin,
        callbackUsed: false,
      };
    } catch (error: unknown) {
      this.fail(record, error);
    } finally {
      this.activeTasks.delete(record);
    }
  }

  private async verifyWeb(
    record: PendingLogin,
    challenge: WebIdentityChallenge,
    code: string,
  ): Promise<void> {
    try {
      const lifetime = AbortSignal.any([
        record.controller.signal,
        AbortSignal.timeout(Math.max(1, record.flow.expiresAt - Date.now())),
      ]);
      const identity = await challenge.complete(code, lifetime);
      this.accept(record, identity);
    } catch (error: unknown) {
      this.fail(record, error);
    } finally {
      this.activeTasks.delete(record);
    }
  }

  public get(clientId: string, id: string): LoginFlow {
    return structuredClone(this.require(clientId, id).flow);
  }

  /** Consume a verified identity before a synchronous, atomic application-session commit. */
  public consume(clientId: string, id: string): VerifiedIdentity {
    const record = this.require(clientId, id);
    if (record.flow.status !== 'completed' || !record.identity || record.consumed)
      throw new LoginError('LOGIN_NOT_READY', '登录尚未完成或已使用，请重新登录。');
    const identity = record.identity;
    delete record.identity;
    record.consumed = true;
    return identity;
  }

  public async cancel(clientId: string, id: string): Promise<void> {
    const record = this.require(clientId, id);
    this.stop(record);
    await record.task;
  }

  public async cancelClient(clientId: string): Promise<void> {
    const known = new Set([...this.flows.values(), ...this.activeTasks.keys()]);
    const records = [...known].filter((record) => record.clientId === clientId);
    for (const record of records) this.stop(record);
    await Promise.all(records.map((record) => record.task));
  }

  public async close(): Promise<void> {
    this.closed = true;
    for (const record of this.flows.values()) this.stop(record);
    for (const record of this.activeTasks.keys()) this.stop(record);
    await Promise.all([...this.activeTasks.values()]);
    this.flows.clear();
  }

  private require(clientId: string, id: string): PendingLogin {
    const record = this.flows.get(id);
    if (!record || record.clientId !== clientId)
      throw new LoginError('LOGIN_NOT_FOUND', '登录流程不存在或不属于当前客户端。', 404);
    if (record.flow.expiresAt <= Date.now()) {
      this.stop(record);
      throw new LoginError('LOGIN_EXPIRED', '登录流程已过期，请重试。');
    }
    return record;
  }

  private stop(record: PendingLogin): void {
    record.controller.abort();
    delete record.identity;
    record.consumed = true;
    record.flow.status = 'cancelled';
    record.flow.deviceCode = null;
  }

  private async verify(record: PendingLogin, starting: Promise<IdentityChallenge>): Promise<void> {
    try {
      const challenge = await starting;
      record.controller.signal.throwIfAborted();
      record.flow.url = challenge.url;
      record.flow.deviceCode = challenge.userCode;
      record.flow.expiresAt = challenge.expiresAt;
      const identity = await challenge.verify(record.controller.signal);
      this.accept(record, identity);
    } catch (error: unknown) {
      this.fail(record, error);
    } finally {
      this.activeTasks.delete(record);
    }
  }

  private accept(record: PendingLogin, identity: VerifiedIdentity): void {
    record.controller.signal.throwIfAborted();
    if (this.closed || record.consumed) return;
    if (Date.now() >= record.flow.expiresAt)
      throw new LoginError('LOGIN_EXPIRED', '登录流程已过期，请重试。');
    if (identity.providerId !== record.flow.providerId)
      throw new LoginError('LOGIN_IDENTITY_INVALID', '登录身份来源不一致。', 502);
    record.identity = identity;
    record.flow.status = 'completed';
    record.flow.deviceCode = null;
  }

  private fail(record: PendingLogin, error: unknown): void {
    delete record.identity;
    record.flow.deviceCode = null;
    if (record.controller.signal.aborted) {
      record.flow.status = 'cancelled';
      return;
    }
    record.flow.status = 'failed';
    record.flow.error = '登录未完成，请重新尝试。';
    if (error instanceof LoginError) record.flow.error = error.message;
    if (Date.now() >= record.flow.expiresAt) record.flow.error = '登录流程已过期，请重试。';
  }
}

function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

function equalNonce(nonce: string, expectedHash: string): boolean {
  return timingSafeEqual(Buffer.from(hashNonce(nonce), 'hex'), Buffer.from(expectedHash, 'hex'));
}
