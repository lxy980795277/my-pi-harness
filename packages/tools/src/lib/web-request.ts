import { Resolver } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { ToolError } from './tool-registry.js';
import { checkCancelled, isPublicAddress } from '@my-pi-harness/sandbox';
import type { WebFetchGatewayAccess } from './tool-context.js';

interface WebResponse {
  status: number;
  location: string | undefined;
  text: string;
}

/** Refuse non-public Web targets, applying IPv4 policy to mapped IPv6 addresses. */
export function assertPublicAddress(address: string): void {
  if (!isPublicAddress(address))
    throw new ToolError(
      'PRIVATE_NETWORK',
      'Web tools cannot access private, local, reserved or metadata addresses',
    );
}

/** Parse an HTTP(S) URL with public-target policy before DNS resolution. */
export function parseWebUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch (cause) {
    throw new ToolError('INVALID_URL', 'A valid HTTP(S) URL is required', { cause });
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port !== '' && url.port !== '80' && url.port !== '443')
  ) {
    throw new ToolError(
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
    throw new ToolError('PRIVATE_NETWORK', 'Local network hostnames are not allowed');
  }
  if (isIP(host)) assertPublicAddress(host);
  url.hash = '';
  return url;
}

/** Only the host-declared daemon gateway can bypass ordinary public-network validation. */
export function gatewayTarget(
  input: string,
  access: WebFetchGatewayAccess | undefined,
): URL | undefined {
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
      throw new ToolError('DNS_FAILED', 'The web hostname could not be resolved');
    for (const entry of addresses) assertPublicAddress(entry.address);
    return addresses;
  } finally {
    signal.removeEventListener('abort', abort);
    resolver.cancel();
  }
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
    fail(new ToolError('RESPONSE_LIMIT', `Web response exceeds ${maximumBytes} bytes`));
    return;
  }
  const encoding = response.headers['content-encoding'];
  if (encoding !== undefined && encoding !== 'identity') {
    fail(
      new ToolError('UNSUPPORTED_ENCODING', 'The server ignored the identity encoding requirement'),
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
    fail(new ToolError('BINARY_RESPONSE', 'Web response is not a supported text document'));
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  response.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > maximumBytes)
      fail(new ToolError('RESPONSE_LIMIT', `Web response exceeds ${maximumBytes} bytes`));
    else chunks.push(chunk);
  });
  response.on('error', () => {
    reject(new ToolError('WEB_FAILED', 'Web response did not complete'));
  });
  response.on('end', () => {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      accept({ status: response.statusCode ?? 0, location: response.headers.location, text });
    } catch {
      reject(new ToolError('BINARY_RESPONSE', 'Web response is not valid UTF-8 text'));
    }
  });
}

/** Make one bounded request using a pinned public address or the exact host-owned gateway. */
export async function requestWebUrl(
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
  if (!selected) throw new ToolError('DNS_FAILED', 'The web hostname has no public address');
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
        new ToolError(
          code,
          signal.aborted ? 'Web request was cancelled or timed out' : 'Web request failed',
          { cause },
        ),
      );
    });
    client.end(body);
  });
}
