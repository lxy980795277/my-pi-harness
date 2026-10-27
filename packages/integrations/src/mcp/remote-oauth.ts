import { NetworkError } from '../network/errors.js';
import {
  auth,
  type OAuthClientProvider,
  type OAuthClientMetadata,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
  type OAuthDiscoveryState,
  type FetchLike,
  type AuthOptions,
  type AuthResult,
} from '@modelcontextprotocol/client';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { randomBytes } from 'node:crypto';
import { McpError } from './errors.js';
import { createRemoteFetch, parseRemoteUrl } from '../network/remote-fetch.js';

type Credential = Static<typeof CredentialSchema>;

export interface RemoteOAuthStore {
  read(): Promise<string | undefined>;
  write(value: string): Promise<void>;
}

export interface RemoteOAuthOptions {
  endpoint: string;
  redirectUrl: string;
  store: RemoteOAuthStore;
  fixtureOrigin?: string;
  fetch?: FetchLike;
  client?: {
    clientId: string;
    issuer: string;
    clientSecret?: string;
    scopes: readonly string[];
    accessTypeOffline: boolean;
  };
}

const TokensSchema = Type.Object({
  access_token: Type.String({ minLength: 1, maxLength: 65536 }),
  token_type: Type.String(),
  issuer: Type.String(),
  expires_in: Type.Optional(Type.Number({ minimum: 0 })),
  refresh_token: Type.Optional(Type.String()),
  scope: Type.Optional(Type.String()),
  resource: Type.Optional(Type.String()),
});

const ClientSchema = Type.Object({
  client_id: Type.String(),
  issuer: Type.String(),
  client_secret: Type.Optional(Type.String()),
  client_id_issued_at: Type.Optional(Type.Number()),
  client_secret_expires_at: Type.Optional(Type.Number()),
});

const CredentialSchema = Type.Object(
  {
    version: Type.Literal(1),
    tokens: Type.Optional(TokensSchema),
    client: Type.Optional(ClientSchema),
    savedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

/** OAuth state belongs to one explicit browser flow; transport calls only receive a token, never this interactive provider. */
export class RemoteOAuthSession implements OAuthClientProvider {
  public readonly redirectUrl: string;
  public readonly clientMetadata: OAuthClientMetadata;
  public readonly nonce = randomBytes(32).toString('base64url');
  private data: Credential = { version: 1, savedAt: 0 };
  private verifier: string | undefined;
  private discovery: OAuthDiscoveryState | undefined;
  private authorizationUrl: URL | undefined;
  private readonly fetch: FetchLike;
  public constructor(private readonly options: RemoteOAuthOptions) {
    this.redirectUrl = options.redirectUrl;
    this.clientMetadata = {
      client_name: 'My Pi Harness MCP',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method:
        options.client?.clientSecret === undefined ? 'none' : 'client_secret_post',
      ...(options.client === undefined ? {} : { scope: options.client.scopes.join(' ') }),
    };
    this.fetch =
      options.fetch ??
      createRemoteFetch({
        validateUtf8: true,
        ...(options.fixtureOrigin === undefined ? {} : { fixtureOrigin: options.fixtureOrigin }),
      });
  }
  public async initialize(): Promise<void> {
    const encoded = await this.options.store.read();
    if (encoded === undefined) return;
    let value: unknown;
    try {
      value = JSON.parse(encoded);
    } catch {
      throw new McpError('OAUTH_CREDENTIAL_INVALID', 'MCP OAuth凭据无效，请断开后重新连接。');
    }
    if (!Value.Check(CredentialSchema, value))
      throw new McpError('OAUTH_CREDENTIAL_INVALID', 'MCP OAuth凭据无效，请断开后重新连接。');
    this.data = value;
  }
  public state(): string {
    return this.nonce;
  }
  public clientInformation(context?: { issuer: string }): StoredOAuthClientInformation | undefined {
    const supplied = this.options.client;
    if (supplied !== undefined) {
      if (context !== undefined && context.issuer !== supplied.issuer)
        throw new McpError('OAUTH_ISSUER_MISMATCH', '预注册客户端与发现的issuer不一致。');
      return {
        client_id: supplied.clientId,
        issuer: supplied.issuer,
        ...(supplied.clientSecret === undefined ? {} : { client_secret: supplied.clientSecret }),
      };
    }
    const client = this.data.client;
    if (client === undefined || (context !== undefined && client.issuer !== context.issuer))
      return undefined;
    return client;
  }
  public async saveClientInformation(client: StoredOAuthClientInformation): Promise<void> {
    const value: unknown = JSON.parse(JSON.stringify(client));
    if (!Value.Check(ClientSchema, value))
      throw new McpError('OAUTH_CREDENTIAL_INVALID', 'MCP OAuth客户端信息缺少issuer。');
    this.data = { ...this.data, client: value };
    await this.persist();
  }
  public tokens(context?: { issuer: string }): StoredOAuthTokens | undefined {
    const tokens = this.data.tokens;
    if (tokens === undefined || (context !== undefined && tokens.issuer !== context.issuer))
      return undefined;
    return tokens;
  }
  public async saveTokens(tokens: StoredOAuthTokens): Promise<void> {
    const value: unknown = JSON.parse(JSON.stringify(tokens));
    if (!Value.Check(TokensSchema, value))
      throw new McpError('OAUTH_CREDENTIAL_INVALID', 'MCP OAuth令牌缺少issuer。');
    this.data = { ...this.data, tokens: value, savedAt: Date.now() };
    await this.persist();
  }
  public redirectToAuthorization(url: URL): void {
    parseRemoteUrl(url, this.options.fixtureOrigin);
    if (this.options.client?.accessTypeOffline) {
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
    }
    this.authorizationUrl = url;
  }
  public saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }
  public codeVerifier(): string {
    if (this.verifier === undefined)
      throw new McpError('OAUTH_FLOW_EXPIRED', 'MCP OAuth授权流程已失效。');
    return this.verifier;
  }
  public saveDiscoveryState(discovery: OAuthDiscoveryState): void {
    this.discovery = discovery;
  }
  public discoveryState(): OAuthDiscoveryState | undefined {
    return this.discovery;
  }
  public async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void> {
    if (scope === 'all' || scope === 'tokens') delete this.data.tokens;
    if (scope === 'all' || scope === 'client') delete this.data.client;
    if (scope === 'all' || scope === 'verifier') this.verifier = undefined;
    if (scope === 'all' || scope === 'discovery') this.discovery = undefined;
    await this.persist();
  }
  private async persist(): Promise<void> {
    if (!Value.Check(CredentialSchema, this.data))
      throw new McpError('OAUTH_CREDENTIAL_INVALID', 'MCP OAuth返回了无效凭据。');
    await this.options.store.write(JSON.stringify(this.data));
  }
  private async authorize(options: AuthOptions): Promise<AuthResult> {
    try {
      return await auth(this, options);
    } catch (error) {
      if (error instanceof McpError || error instanceof NetworkError) throw error;
      throw new McpError('OAUTH_FAILED', 'MCP OAuth授权服务请求失败，请检查配置后重新连接。');
    }
  }
  public async begin(signal: AbortSignal): Promise<{ url: string; state: string }> {
    const result = await this.authorize({
      serverUrl: this.options.endpoint,
      fetchFn: (input, init) =>
        this.fetch(input, {
          ...init,
          signal: AbortSignal.any([
            signal,
            ...(init?.signal === undefined || init.signal === null ? [] : [init.signal]),
          ]),
        }),
      forceReauthorization: true,
    });
    if (result !== 'REDIRECT' || this.authorizationUrl === undefined)
      throw new McpError('OAUTH_REDIRECT_REQUIRED', 'MCP OAuth未返回授权页面。');
    return { url: this.authorizationUrl.toString(), state: this.nonce };
  }
  public async complete(params: URLSearchParams, signal: AbortSignal): Promise<void> {
    if (params.get('state') !== this.nonce || params.get('code') === null)
      throw new McpError('OAUTH_STATE_INVALID', 'MCP OAuth回调无效。');
    const code = params.get('code');
    if (code === null) throw new McpError('OAUTH_STATE_INVALID', 'MCP OAuth缺少授权码。');
    const issuer = params.get('iss');
    const result = await this.authorize({
      serverUrl: this.options.endpoint,
      authorizationCode: code,
      ...(issuer === null ? {} : { iss: issuer }),
      fetchFn: (input, init) =>
        this.fetch(input, {
          ...init,
          signal: AbortSignal.any([
            signal,
            ...(init?.signal === undefined || init.signal === null ? [] : [init.signal]),
          ]),
        }),
    });
    this.verifier = undefined;
    if (result !== 'AUTHORIZED')
      throw new McpError('OAUTH_AUTHORIZATION_FAILED', 'MCP OAuth没有完成授权。');
  }
  public async accessToken(signal: AbortSignal): Promise<string> {
    const tokens = this.data.tokens;
    if (tokens === undefined) throw new McpError('OAUTH_REQUIRED', '请先连接MCP OAuth账号。');
    if (
      tokens.expires_in !== undefined &&
      Date.now() >= this.data.savedAt + tokens.expires_in * 1000 - 30000
    ) {
      const result = await this.authorize({
        serverUrl: this.options.endpoint,
        fetchFn: (input, init) =>
          this.fetch(input, {
            ...init,
            signal: AbortSignal.any([
              signal,
              ...(init?.signal === undefined || init.signal === null ? [] : [init.signal]),
            ]),
          }),
      });
      if (result !== 'AUTHORIZED')
        throw new McpError('OAUTH_EXPIRED', 'MCP OAuth授权已失效，请重新连接。');
    }
    const current = this.data.tokens;
    if (current === undefined) throw new McpError('OAUTH_REQUIRED', 'MCP OAuth令牌不可用。');
    return current.access_token;
  }
}
