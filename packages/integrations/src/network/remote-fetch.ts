import type { LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import {
  createPinnedLookup,
  isPublicAddress,
  resolveSocketAddress,
  SandboxError,
} from '@my-pi-harness/sandbox/network';
import type { FetchLike } from '@modelcontextprotocol/client';
import { NetworkError } from './errors';

export interface RemoteNetworkOptions {
  /** Only host tests may explicitly inject an exact local fixture origin. */
  fixtureOrigin?: string;
  signal?: AbortSignal;
  allowedOrigins?: ReadonlySet<string>;
  beforeRequest?: (url: URL, init: RequestInit) => Promise<void>;
  maximumResponseBytes?: number;
  validateUtf8?: boolean;
}

export function assertRemoteAddress(address: string): void {
  if (isPublicAddress(address)) return;
  throw new NetworkError('PRIVATE_NETWORK', '远程连接禁止访问本机、私有、保留或元数据地址。');
}
export function parseRemoteUrl(input: string | URL, fixtureOrigin?: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new NetworkError('INVALID_URL', '远程地址无效。');
  }
  const fixture = fixtureOrigin !== undefined && url.origin === fixtureOrigin;
  if (
    (!fixture && (url.protocol !== 'https:' || (url.port !== '' && url.port !== '443'))) ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  )
    throw new NetworkError('INVALID_URL', '远程地址必须使用HTTPS标准端口，不能包含凭据或片段。');
  for (const key of url.searchParams.keys())
    if (
      /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|password|secret)$/i.test(
        key,
      )
    )
      throw new NetworkError('URL_CREDENTIAL_FORBIDDEN', '认证信息不能放在远程URL中。');
  if (!fixture) {
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      hostname === 'localhost' ||
      ['.localhost', '.local', '.internal'].some((suffix) => hostname.endsWith(suffix))
    )
      throw new NetworkError('PRIVATE_NETWORK', '本地网络域名不可用。');
    if (isIP(hostname)) assertRemoteAddress(hostname);
  }
  return url;
}
async function resolveAddress(
  url: URL,
  signal: AbortSignal,
  fixtureOrigin?: string,
): Promise<LookupAddress> {
  try {
    return await resolveSocketAddress(url.hostname.replace(/^\[|\]$/g, ''), signal, (address) => {
      if (url.origin !== fixtureOrigin) assertRemoteAddress(address);
    });
  } catch (error) {
    if (error instanceof SandboxError && error.code === 'DNS_FAILED')
      throw new NetworkError('DNS_FAILED', '远程地址解析失败。');
    throw error;
  }
}
function responseBody(
  response: IncomingMessage,
  maximum: number,
  signal: AbortSignal,
  validateUtf8: boolean,
): ReadableStream<Uint8Array> {
  let bytes = 0;
  const decoder = validateUtf8 ? new TextDecoder('utf-8', { fatal: true }) : undefined;
  const chunks = response[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        signal.throwIfAborted();
        const chunk = await chunks.next();
        if (chunk.done) {
          decoder?.decode();
          controller.close();
          return;
        }
        const value: unknown = chunk.value;
        if (!Buffer.isBuffer(value))
          throw new NetworkError('INVALID_RESPONSE', '远程响应不是字节流。');
        bytes += value.length;
        if (bytes > maximum) throw new NetworkError('RESPONSE_LIMIT', '远程响应超过限制。');
        decoder?.decode(value, { stream: true });
        controller.enqueue(value);
      } catch (error) {
        response.destroy();
        controller.error(error);
      }
    },
    async cancel() {
      response.destroy();
      await chunks.return?.();
    },
  });
}

/** DNS is checked and pinned on every socket; redirects, ambient proxy and cookies are never followed. */
export function createRemoteFetch(options: RemoteNetworkOptions = {}): FetchLike {
  return async (input, init = {}) => {
    const url = parseRemoteUrl(input instanceof Request ? input.url : input, options.fixtureOrigin);
    if (options.allowedOrigins !== undefined && !options.allowedOrigins.has(url.origin))
      throw new NetworkError('ORIGIN_FORBIDDEN', '远程请求不能跨越已授权来源。');
    const signals = [options.signal, init.signal].filter(
      (signal): signal is AbortSignal => signal !== null && signal !== undefined,
    );
    const timeout = AbortSignal.timeout(120000);
    const signal = AbortSignal.any([...signals, timeout]);
    const selected = await resolveAddress(url, signal, options.fixtureOrigin);
    const headers = new Headers(init.headers);
    for (const name of ['cookie', 'proxy-authorization', 'host', 'connection', 'transfer-encoding'])
      if (headers.has(name)) throw new NetworkError('HEADER_FORBIDDEN', '远程请求包含受限头。');
    headers.set('accept-encoding', 'identity');
    const body = init.body;
    let bytes: Buffer | undefined;
    if (typeof body === 'string') bytes = Buffer.from(body);
    else if (body instanceof URLSearchParams) bytes = Buffer.from(body.toString());
    else if (body !== undefined && body !== null)
      throw new NetworkError('INVALID_REQUEST', '远程请求正文类型不受支持。');
    if (bytes !== undefined && bytes.length > 4 * 1024 * 1024)
      throw new NetworkError('REQUEST_LIMIT', '远程请求正文超过限制。');
    if (bytes !== undefined) headers.set('content-length', String(bytes.length));
    signal.throwIfAborted();
    await options.beforeRequest?.(url, init);
    signal.throwIfAborted();
    return await new Promise<Response>((accept, reject) => {
      const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const client = request(
        url,
        {
          method: init.method ?? 'GET',
          headers: Object.fromEntries(headers),
          agent: false,
          signal,
          lookup: createPinnedLookup(selected),
        },
        (response) => {
          const status = response.statusCode ?? 500;
          if (status >= 300 && status < 400) {
            response.destroy();
            reject(new NetworkError('REDIRECT_FORBIDDEN', '远程重定向已被拒绝。'));
            return;
          }
          if (
            response.headers['content-encoding'] !== undefined &&
            response.headers['content-encoding'] !== 'identity'
          ) {
            response.destroy();
            reject(new NetworkError('ENCODING_FORBIDDEN', '远程响应编码不受支持。'));
            return;
          }
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers))
            if (value !== undefined)
              responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
          const maximum = options.maximumResponseBytes ?? 8 * 1024 * 1024;
          if (Number(response.headers['content-length'] ?? 0) > maximum) {
            response.destroy();
            reject(new NetworkError('RESPONSE_LIMIT', '远程响应超过限制。'));
            return;
          }
          const stream =
            status === 204 || status === 205 || init.method === 'HEAD'
              ? null
              : responseBody(response, maximum, signal, options.validateUtf8 === true);
          if (stream === null) response.resume();
          accept(new Response(stream, { status, headers: responseHeaders }));
        },
      );
      client.on('error', () =>
        reject(
          new NetworkError(signal.aborted ? 'CANCELLED' : 'NETWORK_FAILED', '远程连接中断或超时。'),
        ),
      );
      client.end(bytes);
    });
  };
}
