import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AuthFlow, AuthStatus } from '@my-pi-harness/protocol';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

const DeviceSchema = Type.Object({
  device_code: Type.String(),
  user_code: Type.String(),
  verification_uri: Type.String(),
  expires_in: Type.Integer({ minimum: 1, maximum: 1800 }),
  interval: Type.Integer({ minimum: 1, maximum: 60 }),
});
const TokenSchema = Type.Object({
  access_token: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  interval: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })),
});
const IdentitySchema = Type.Object({ login: Type.String(), avatar_url: Type.String() });
interface DeviceTask {
  flow: AuthFlow;
  controller: AbortController;
  task: Promise<void>;
}
interface WebChallenge {
  verifier: string;
  callback: string;
  expiresAt: number;
}

/** Optional application identity configuration; provider OAuth remains in Pi. */
export interface GitHubAuthOptions {
  clientId: string;
  clientSecret?: string;
  fetch?: typeof fetch;
  onIdentity(identity: NonNullable<AuthStatus['identity']>): void;
}

/** Uses GitHub PKCE or device grant and discards the access token after identity lookup. */
export class GitHubAuth {
  private readonly challenges = new Map<string, WebChallenge>();
  private readonly webTasks = new Map<AbortController, Promise<void>>();
  private readonly devices = new Map<string, DeviceTask>();
  private readonly request: typeof fetch;
  private closed = false;
  public constructor(private readonly options: GitHubAuthOptions) {
    this.request = options.fetch ?? fetch;
  }

  public startWeb(origin: string): string {
    if (this.closed) throw new Error('AUTH_CLOSED');
    if (!this.options.clientSecret) throw new Error('AUTH_CLIENT_SECRET_REQUIRED');
    for (const [id, challenge] of this.challenges)
      if (challenge.expiresAt < Date.now()) this.challenges.delete(id);
    if (this.challenges.size >= 10) throw new Error('AUTH_FLOW_LIMIT');
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const callback = `${origin}/api/auth/github/callback`;
    this.challenges.set(state, { verifier, callback, expiresAt: Date.now() + 600_000 });
    const url = new URL('https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: callback,
      state,
      scope: 'read:user',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return url.href;
  }

  public async finishWeb(state: string, code: string): Promise<void> {
    const challenge = this.challenges.get(state);
    this.challenges.delete(state);
    if (!challenge || challenge.expiresAt < Date.now() || this.closed)
      throw new Error('AUTH_STATE_INVALID');
    const controller = new AbortController();
    const task = (async (): Promise<void> => {
      const token = await this.token(
        {
          code,
          client_id: this.options.clientId,
          code_verifier: challenge.verifier,
          redirect_uri: challenge.callback,
          ...(this.options.clientSecret ? { client_secret: this.options.clientSecret } : {}),
        },
        controller.signal,
      );
      if (!token.access_token) throw new Error('AUTH_EXCHANGE_FAILED');
      await this.identify(token.access_token, controller.signal);
    })();
    this.webTasks.set(controller, task);
    try {
      await task;
    } finally {
      this.webTasks.delete(controller);
    }
  }

  public async startDevice(): Promise<AuthFlow> {
    if (this.closed) throw new Error('AUTH_CLOSED');
    for (const [id, task] of this.devices)
      if (task.flow.status !== 'pending') this.devices.delete(id);
    if ([...this.devices.values()].some(({ flow }) => flow.status === 'pending'))
      throw new Error('AUTH_FLOW_BUSY');
    const controller = new AbortController();
    const response = await this.post(
      'https://github.com/login/device/code',
      { client_id: this.options.clientId, scope: 'read:user' },
      controller.signal,
    );
    if (!Value.Check(DeviceSchema, response)) throw new Error('AUTH_DEVICE_INVALID');
    const verification = new URL(response.verification_uri);
    if (verification.origin !== 'https://github.com') throw new Error('AUTH_DEVICE_INVALID');
    const flow: AuthFlow = {
      id: randomUUID(),
      providerId: 'application:github',
      status: 'pending',
      url: verification.href,
      deviceCode: response.user_code,
      prompt: null,
      message: 'Enter the device code in GitHub.',
      error: null,
    };
    const task = this.poll(flow, response, controller.signal).catch(() => {
      if (flow.status === 'pending') {
        flow.status = controller.signal.aborted ? 'cancelled' : 'failed';
        flow.error = 'GitHub authentication did not complete.';
      }
    });
    this.devices.set(flow.id, { flow, controller, task });
    return structuredClone(flow);
  }

  public list(): AuthFlow[] {
    return [...this.devices.values()].map(({ flow }) => structuredClone(flow));
  }

  public owns(id: string): boolean {
    return this.devices.has(id);
  }
  public get(id: string): AuthFlow {
    const task = this.devices.get(id);
    if (!task) throw new Error('AUTH_FLOW_NOT_FOUND');
    return structuredClone(task.flow);
  }
  public cancel(id: string): AuthFlow {
    const task = this.devices.get(id);
    if (!task) throw new Error('AUTH_FLOW_NOT_FOUND');
    if (task.flow.status === 'pending') {
      task.flow.status = 'cancelled';
      task.controller.abort();
    }
    return structuredClone(task.flow);
  }
  /** Revoke unfinished identity grants without disabling later logins. */
  public async cancelPending(): Promise<void> {
    this.challenges.clear();
    for (const controller of this.webTasks.keys()) controller.abort();
    for (const task of this.devices.values())
      if (task.flow.status === 'pending') this.cancel(task.flow.id);
    await Promise.allSettled([...this.webTasks.values()]);
    await Promise.all([...this.devices.values()].map(({ task }) => task));
  }

  public async close(): Promise<void> {
    this.closed = true;
    this.challenges.clear();
    for (const controller of this.webTasks.keys()) controller.abort();
    for (const { controller } of this.devices.values()) controller.abort();
    await Promise.allSettled([...this.webTasks.values()]);
    await Promise.all([...this.devices.values()].map(({ task }) => task));
    this.devices.clear();
  }

  private async poll(
    flow: AuthFlow,
    device: Static<typeof DeviceSchema>,
    signal: AbortSignal,
  ): Promise<void> {
    const expiresAt = Date.now() + device.expires_in * 1000;
    let interval = device.interval;
    while (Date.now() < expiresAt) {
      await delay(interval * 1000, undefined, { signal });
      const result = await this.token(
        {
          client_id: this.options.clientId,
          device_code: device.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        },
        signal,
      );
      if (result.access_token) {
        await this.identify(result.access_token, signal);
        signal.throwIfAborted();
        flow.status = 'completed';
        flow.deviceCode = null;
        return;
      }
      if (result.error === 'slow_down') interval = result.interval ?? interval + 5;
      else if (result.error !== 'authorization_pending') throw new Error('AUTH_DEVICE_DENIED');
    }
    throw new Error('AUTH_DEVICE_EXPIRED');
  }
  private async identify(token: string, signal: AbortSignal): Promise<void> {
    const response = await this.request('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'my-pi-harness',
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      redirect: 'error',
    });
    const data: unknown = await response.json();
    if (!response.ok || !Value.Check(IdentitySchema, data))
      throw new Error('AUTH_IDENTITY_INVALID');
    signal.throwIfAborted();
    this.options.onIdentity({ name: data.login, avatarUrl: data.avatar_url });
  }
  private async token(
    fields: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Static<typeof TokenSchema>> {
    const value = await this.post('https://github.com/login/oauth/access_token', fields, signal);
    if (!Value.Check(TokenSchema, value)) throw new Error('AUTH_TOKEN_INVALID');
    return value;
  }
  private async post(
    url: string,
    fields: Record<string, string>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const response = await this.request(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('AUTH_HTTP_FAILED');
    return response.json();
  }
}
