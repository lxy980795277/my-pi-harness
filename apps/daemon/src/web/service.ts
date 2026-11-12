import type { WebSearchInput, WebServiceStatus } from '@my-pi-harness/protocol';
import type {
  WebPageInput,
  WebPageResult,
  WebSearchResult,
} from '@my-pi-harness/protocol/internal';
import type { CredentialStore } from '@my-pi-harness/storage';
import { DeepSeekWebClient } from '@my-pi-harness/integrations';

export interface WebServiceOptions {
  credentials: CredentialStore;
  /** Explicit fixture transport; production always uses the official provider. */
  fetch?: typeof fetch;
}

export type WebConfigurationErrorCode =
  | 'WEB_NOT_CONFIGURED'
  | 'WEB_CREDENTIAL_UNAVAILABLE'
  | 'WEB_CLOSED';

const CREDENTIAL_REF = 'web.deepseek.api-key';
const REQUEST_TIMEOUT_MS = 30_000;

/** Safe configuration failures belong to the host, independently of provider responses. */
export class WebConfigurationError extends Error {
  public constructor(
    public readonly code: WebConfigurationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WebConfigurationError';
  }
}

/** Profile-owned web credentials and cancellable operations, independent of chat providers. */
export class WebService {
  private readonly client: DeepSeekWebClient;
  private readonly lifetime = new AbortController();
  private generation = new AbortController();
  private configuration: Promise<void> = Promise.resolve();
  private readonly operations = new Set<Promise<unknown>>();
  private closed = false;
  private closing: Promise<void> | undefined;

  public constructor(private readonly options: WebServiceOptions) {
    this.client = new DeepSeekWebClient(options.fetch ? { fetch: options.fetch } : {});
  }

  /** Public settings disclose only whether a dedicated web credential exists. */
  public async status(): Promise<WebServiceStatus> {
    return await this.owned(async () => {
      await this.configuration;
      this.ensureOpen();
      const key = await this.readKey();
      this.ensureOpen();
      return { provider: 'deepseek', configured: key !== undefined };
    });
  }

  /** Replacement and removal revoke existing requests before persisting the new credential. */
  public async setCredential(apiKey: string | undefined): Promise<WebServiceStatus> {
    this.ensureOpen();
    const previous = this.configuration;
    const change = previous.then(async (): Promise<WebServiceStatus> => {
      this.ensureOpen();
      this.generation.abort();
      this.generation = new AbortController();
      try {
        if (apiKey === undefined) await this.options.credentials.delete(CREDENTIAL_REF);
        else await this.options.credentials.write(CREDENTIAL_REF, apiKey);
      } catch {
        throw new WebConfigurationError(
          'WEB_CREDENTIAL_UNAVAILABLE',
          '联网搜索凭据无法保存，请检查系统凭据服务。',
        );
      }
      this.ensureOpen();
      return { provider: 'deepseek', configured: apiKey !== undefined };
    });
    this.configuration = change.then(
      () => undefined,
      () => undefined,
    );
    return await this.owned(() => change);
  }

  public async search(input: WebSearchInput, signal: AbortSignal): Promise<WebSearchResult> {
    return await this.request(signal, (key, requestSignal) =>
      this.client.search(input, key, requestSignal),
    );
  }

  public async fetchPage(input: WebPageInput, signal: AbortSignal): Promise<WebPageResult> {
    return await this.request(signal, (key, requestSignal) =>
      this.client.fetchPage(input, key, requestSignal),
    );
  }

  private async request<T>(
    caller: AbortSignal,
    operation: (key: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return await this.owned(async () => {
      const waitingSignal = AbortSignal.any([
        caller,
        this.lifetime.signal,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ]);
      await waitForConfiguration(this.configuration, waitingSignal);
      this.ensureOpen();
      const signal = AbortSignal.any([waitingSignal, this.generation.signal]);
      signal.throwIfAborted();
      const key = await this.readKey();
      signal.throwIfAborted();
      if (key === undefined)
        throw new WebConfigurationError(
          'WEB_NOT_CONFIGURED',
          '请先在设置的“联网搜索”中配置DeepSeek API Key。',
        );
      const result = await operation(key, signal);
      signal.throwIfAborted();
      return result;
    });
  }

  private async readKey(): Promise<string | undefined> {
    try {
      return await this.options.credentials.read(CREDENTIAL_REF);
    } catch {
      throw new WebConfigurationError(
        'WEB_CREDENTIAL_UNAVAILABLE',
        '联网搜索凭据无法读取，请检查系统凭据服务。',
      );
    }
  }

  private async owned<T>(operation: () => Promise<T>): Promise<T> {
    this.ensureOpen();
    const pending = operation();
    this.operations.add(pending);
    try {
      return await pending;
    } finally {
      this.operations.delete(pending);
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new WebConfigurationError('WEB_CLOSED', '联网服务已关闭。');
  }

  public stopAccepting(): void {
    this.closed = true;
    this.lifetime.abort();
    this.generation.abort();
  }

  /** Closing also waits for system credential operations which cannot be interrupted. */
  public close(): Promise<void> {
    this.closing ??= (async () => {
      this.stopAccepting();
      await Promise.allSettled([...this.operations]);
    })();
    return this.closing;
  }
}

/** Cancelling a queued caller does not cancel the independently owned system credential write. */
async function waitForConfiguration(
  configuration: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  let abort = (): void => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = (): void => {
      const reason: unknown = signal.reason;
      reject(
        reason instanceof Error ? reason : new DOMException('Web request cancelled', 'AbortError'),
      );
    };
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    await Promise.race([configuration, cancelled]);
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
