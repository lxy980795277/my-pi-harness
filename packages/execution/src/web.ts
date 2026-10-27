import { Resolver } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { stringArgument } from './catalog.js';
import { ExecutionError, checkCancelled } from './errors.js';
import type { WebFetchContext, ExecutionResult, WebFetchGatewayAccess } from './types.js';

const deniedV4 = new BlockList();
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
  deniedV4.addSubnet(address, prefix, 'ipv4');
const allowedV6 = new BlockList();
allowedV6.addSubnet('2000::', 3, 'ipv6');
const deniedV6 = new BlockList();
deniedV6.addSubnet('2001::', 23, 'ipv6');
deniedV6.addSubnet('2001:db8::', 32, 'ipv6');
deniedV6.addSubnet('2002::', 16, 'ipv6');
deniedV6.addSubnet('3fff::', 20, 'ipv6');

/** Refuse non-public ranges, including mapped IPv4 addresses and transition networks. */
export function assertPublicAddress(address: string): void {
  const family = isIP(address);
  const publicV4 = family === 4 && !deniedV4.check(address, 'ipv4');
  const publicV6 =
    family === 6 && allowedV6.check(address, 'ipv6') && !deniedV6.check(address, 'ipv6');
  if (!publicV4 && !publicV6)
    throw new ExecutionError(
      'PRIVATE_NETWORK',
      'Web tools cannot access private, local, reserved or metadata addresses',
    );
}

export function parseWebUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch (cause) {
    throw new ExecutionError('INVALID_URL', 'A valid HTTP(S) URL is required', { cause });
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port !== '' && url.port !== '80' && url.port !== '443')
  ) {
    throw new ExecutionError(
      'INVALID_URL',
      'Web tools require HTTP(S), a standard port, and no URL credentials',
    );
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new ExecutionError('PRIVATE_NETWORK', 'Local network hostnames are not allowed');
  }
  if (isIP(host)) assertPublicAddress(host);
  url.hash = '';
  return url;
}

/** Only the host-declared daemon gateway can bypass ordinary public-network validation. */
function gatewayTarget(input: string, access: WebFetchGatewayAccess | undefined): URL | undefined {
  if (access === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  if (
    url.origin !== access.origin ||
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username !== '' ||
    url.password !== '' ||
    !/^\/api\/skill-gateway\/[a-z][a-z0-9-]*\/.+/.test(url.pathname)
  )
    return undefined;
  url.hash = '';
  return url;
}

/** Resolve through an owned resolver so abort cancels DNS; the returned address is used by the socket. */
async function publicAddresses(
  url: URL,
  signal: AbortSignal,
): Promise<{ address: string; family: number }[]> {
  checkCancelled(signal);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  if (family) return [{ address: hostname, family }];
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  const abort = (): void => {
    resolver.cancel();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const answers = await Promise.allSettled([
      resolver.resolve4(hostname),
      resolver.resolve6(hostname),
    ]);
    checkCancelled(signal);
    const addresses = answers.flatMap((answer, index) =>
      answer.status === 'fulfilled'
        ? answer.value.map((address) => ({ address, family: index === 0 ? 4 : 6 }))
        : [],
    );
    if (addresses.length === 0)
      throw new ExecutionError('DNS_FAILED', 'The web hostname could not be resolved');
    for (const entry of addresses) assertPublicAddress(entry.address);
    return addresses;
  } finally {
    signal.removeEventListener('abort', abort);
    resolver.cancel();
  }
}

interface WebResponse {
  status: number;
  location: string | undefined;
  text: string;
}

function readResponse(
  response: IncomingMessage,
  accept: (value: WebResponse) => void,
  reject: (error: Error) => void,
  maximumBytes: number,
): void {
  const fail = (error: Error): void => {
    response.destroy();
    reject(error);
  };
  const length = Number(response.headers['content-length'] ?? 0);
  if (length > maximumBytes) {
    fail(new ExecutionError('RESPONSE_LIMIT', `Web response exceeds ${maximumBytes} bytes`));
    return;
  }
  const encoding = response.headers['content-encoding'];
  if (encoding !== undefined && encoding !== 'identity') {
    fail(
      new ExecutionError(
        'UNSUPPORTED_ENCODING',
        'The server ignored the identity encoding requirement',
      ),
    );
    return;
  }
  const contentType = response.headers['content-type'] ?? '';
  if (
    contentType &&
    !/^(text\/|application\/(?:json|[^;]+\+json|xml|xhtml\+xml|javascript))/.test(
      contentType.toLowerCase(),
    )
  ) {
    fail(new ExecutionError('BINARY_RESPONSE', 'Web response is not a supported text document'));
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  response.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > maximumBytes)
      fail(new ExecutionError('RESPONSE_LIMIT', `Web response exceeds ${maximumBytes} bytes`));
    else chunks.push(chunk);
  });
  response.on('error', () => {
    reject(new ExecutionError('WEB_FAILED', 'Web response did not complete'));
  });
  response.on('end', () => {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      accept({ status: response.statusCode ?? 0, location: response.headers.location, text });
    } catch {
      reject(new ExecutionError('BINARY_RESPONSE', 'Web response is not valid UTF-8 text'));
    }
  });
}

async function requestUrl(
  url: URL,
  method: string,
  body: string | undefined,
  contentType: string,
  signal: AbortSignal,
  gateway?: WebFetchGatewayAccess,
): Promise<WebResponse> {
  const addresses = gateway
    ? [{ address: '127.0.0.1', family: 4 }]
    : await publicAddresses(url, signal);
  const selected = addresses[0];
  if (!selected) throw new ExecutionError('DNS_FAILED', 'The web hostname has no public address');
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return await new Promise<WebResponse>((accept, reject) => {
    const client = request(
      url,
      {
        method,
        signal,
        agent: false,
        headers: {
          'accept-encoding': 'identity',
          'user-agent': 'MyPiHarness/0.1',
          ...(gateway === undefined ? {} : { 'x-pi-harness-skill-gateway': gateway.token }),
          ...(body === undefined
            ? {}
            : { 'content-type': contentType, 'content-length': Buffer.byteLength(body) }),
        },
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [selected]);
          else callback(null, selected.address, selected.family);
        },
      },
      (response) => {
        readResponse(response, accept, reject, gateway === undefined ? 500_000 : 5 * 1024 * 1024);
      },
    );
    client.on('error', (cause) => {
      const code = signal.aborted ? 'CANCELLED' : 'WEB_FAILED';
      reject(
        new ExecutionError(
          code,
          signal.aborted ? 'Web request was cancelled or timed out' : 'Web request failed',
          { cause },
        ),
      );
    });
    client.end(body);
  });
}

/** No cookies, ambient proxy, auth headers, automatic retry, or unchecked redirects. */
export async function webFetchTool(
  args: Record<string, unknown>,
  context: WebFetchContext,
): Promise<ExecutionResult> {
  const method = stringArgument(args, 'method', 'GET');
  if (context.readOnly && method !== 'GET')
    throw new ExecutionError('READ_ONLY', 'Network writes are disabled by the current policy');
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(15_000)]);
  const input = stringArgument(args, 'url');
  const gatewayUrl = gatewayTarget(input, context.skillGateway);
  const gateway = gatewayUrl === undefined ? undefined : context.skillGateway;
  let url = gatewayUrl ?? parseWebUrl(input);
  if (gateway !== undefined && (method !== 'GET' || args['body'] !== undefined))
    throw new ExecutionError('READ_ONLY', 'Plugin gateways accept read-only GET requests only');
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    checkCancelled(signal);
    const response = await requestUrl(
      url,
      method,
      args['body'] === undefined ? undefined : stringArgument(args, 'body'),
      stringArgument(args, 'contentType', 'text/plain'),
      signal,
      gateway,
    );
    if (response.status >= 300 && response.status < 400 && response.location !== undefined) {
      if (gateway !== undefined)
        throw new ExecutionError('UNSAFE_REDIRECT', 'Plugin gateway redirects are not followed');
      const target = parseWebUrl(new URL(response.location, url).href);
      if (url.protocol === 'https:' && target.protocol === 'http:')
        throw new ExecutionError('UNSAFE_REDIRECT', 'HTTPS redirects cannot downgrade to HTTP');
      if (method !== 'GET')
        return {
          summary: `HTTP ${response.status}; POST redirect was not followed`,
          content: [
            {
              type: 'text',
              text: `HTTP ${response.status}\nRedirect requires a new approved request: ${target.href}\n${response.text.slice(0, 100_000)}`,
            },
          ],
        };
      if (redirects === 4)
        throw new ExecutionError('REDIRECT_LIMIT', 'Web request exceeded its redirect limit');
      url = target;
      continue;
    }
    return {
      summary: `HTTP ${response.status} ${url.hostname}`,
      content: [
        {
          type: 'text',
          text: `URL: ${url.href}\nHTTP ${response.status}\n${response.text.slice(0, 100_000)}${response.text.length > 100_000 ? '\n[Response truncated]' : ''}`,
        },
      ],
    };
  }
  throw new ExecutionError('REDIRECT_LIMIT', 'Web request exceeded its redirect limit');
}
