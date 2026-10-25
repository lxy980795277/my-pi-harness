import { Resolver } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { FetchLike } from '@modelcontextprotocol/client';
import { McpError } from './errors.js';

const denied = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  denied.addSubnet(address, prefix, 'ipv4');
const publicV6 = new BlockList();
publicV6.addSubnet('2000::', 3, 'ipv6');
const deniedV6 = new BlockList();
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  deniedV6.addSubnet(address, prefix, 'ipv6');

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
  const family = isIP(address);
  if (
    (family === 4 && !denied.check(address, 'ipv4')) ||
    (family === 6 && publicV6.check(address, 'ipv6') && !deniedV6.check(address, 'ipv6'))
  )
    return;
  throw new McpError('PRIVATE_NETWORK', '远程连接禁止访问本机、私有、保留或元数据地址。');
}
export function parseRemoteUrl(input: string | URL, fixtureOrigin?: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new McpError('INVALID_URL', '远程地址无效。');
  }
  const fixture = fixtureOrigin !== undefined && url.origin === fixtureOrigin;
  if (
    (!fixture && (url.protocol !== 'https:' || (url.port !== '' && url.port !== '443'))) ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  )
    throw new McpError('INVALID_URL', '远程地址必须使用HTTPS标准端口，不能包含凭据或片段。');
  for (const key of url.searchParams.keys())
    if (
      /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|password|secret)$/i.test(
        key,
      )
    )
      throw new McpError('URL_CREDENTIAL_FORBIDDEN', '认证信息不能放在远程URL中。');
  if (!fixture) {
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      hostname === 'localhost' ||
      ['.localhost', '.local', '.internal'].some((suffix) => hostname.endsWith(suffix))
    )
      throw new McpError('PRIVATE_NETWORK', '本地网络域名不可用。');
    if (isIP(hostname)) assertRemoteAddress(hostname);
  }
  return url;
}
async function resolveAddress(
  url: URL,
  signal: AbortSignal,
  fixtureOrigin?: string,
): Promise<{ address: string; family: number }> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  if (family !== 0) return { address: hostname, family };
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  const cancel = (): void => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const results = await Promise.allSettled([
      resolver.resolve4(hostname),
      resolver.resolve6(hostname),
    ]);
    signal.throwIfAborted();
    const addresses = results.flatMap((result, index) =>
      result.status === 'fulfilled'
        ? result.value.map((address) => ({ address, family: index === 0 ? 4 : 6 }))
        : [],
    );
    if (addresses.length === 0) throw new McpError('DNS_FAILED', '远程地址解析失败。');
    if (url.origin !== fixtureOrigin)
      for (const address of addresses) assertRemoteAddress(address.address);
    const selected = addresses[0];
    if (selected === undefined) throw new McpError('DNS_FAILED', '远程地址没有可用记录。');
    return selected;
  } finally {
    signal.removeEventListener('abort', cancel);
    resolver.cancel();
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
        if (!Buffer.isBuffer(value)) throw new McpError('INVALID_RESPONSE', '远程响应不是字节流。');
        bytes += value.length;
        if (bytes > maximum) throw new McpError('RESPONSE_LIMIT', '远程响应超过限制。');
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
      throw new McpError('ORIGIN_FORBIDDEN', '远程请求不能跨越已授权来源。');
    const signals = [options.signal, init.signal].filter(
      (signal): signal is AbortSignal => signal !== null && signal !== undefined,
    );
    const timeout = AbortSignal.timeout(120000);
    const signal = AbortSignal.any([...signals, timeout]);
    const selected = await resolveAddress(url, signal, options.fixtureOrigin);
    const headers = new Headers(init.headers);
    for (const name of ['cookie', 'proxy-authorization', 'host', 'connection', 'transfer-encoding'])
      if (headers.has(name)) throw new McpError('HEADER_FORBIDDEN', '远程请求包含受限头。');
    headers.set('accept-encoding', 'identity');
    const body = init.body;
    let bytes: Buffer | undefined;
    if (typeof body === 'string') bytes = Buffer.from(body);
    else if (body instanceof URLSearchParams) bytes = Buffer.from(body.toString());
    else if (body !== undefined && body !== null)
      throw new McpError('INVALID_REQUEST', '远程请求正文类型不受支持。');
    if (bytes !== undefined && bytes.length > 4 * 1024 * 1024)
      throw new McpError('REQUEST_LIMIT', '远程请求正文超过限制。');
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
          lookup: (_host, lookupOptions, callback) => {
            if (lookupOptions.all) callback(null, [selected]);
            else callback(null, selected.address, selected.family);
          },
        },
        (response) => {
          const status = response.statusCode ?? 500;
          if (status >= 300 && status < 400) {
            response.destroy();
            reject(new McpError('REDIRECT_FORBIDDEN', '远程重定向已被拒绝。'));
            return;
          }
          if (
            response.headers['content-encoding'] !== undefined &&
            response.headers['content-encoding'] !== 'identity'
          ) {
            response.destroy();
            reject(new McpError('ENCODING_FORBIDDEN', '远程响应编码不受支持。'));
            return;
          }
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers))
            if (value !== undefined)
              responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
          const maximum = options.maximumResponseBytes ?? 8 * 1024 * 1024;
          if (Number(response.headers['content-length'] ?? 0) > maximum) {
            response.destroy();
            reject(new McpError('RESPONSE_LIMIT', '远程响应超过限制。'));
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
          new McpError(signal.aborted ? 'CANCELLED' : 'NETWORK_FAILED', '远程连接中断或超时。'),
        ),
      );
      client.end(bytes);
    });
  };
}
