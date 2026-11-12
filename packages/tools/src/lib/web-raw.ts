import type { LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { ToolError } from './tool-registry';
import { checkCancelled } from '@my-pi-harness/sandbox';
import {
  createPinnedLookup,
  isPublicAddress,
  resolveSocketAddress,
  SandboxError,
} from '@my-pi-harness/sandbox/network';
import type { WebFetchGatewayAccess } from './tool-context';

export interface RawWebRequest {
  url: string;
  method: 'GET' | 'POST';
  body: string | undefined;
  contentType: string;
}
export interface RawWebResponse {
  url: URL;
  status: number;
  text: string;
  redirectUrl?: string;
}
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
  if (input.length > 8192)
    throw new ToolError('INVALID_URL', 'Web URLs cannot exceed 8192 characters');
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

async function publicAddress(url: URL, signal: AbortSignal): Promise<LookupAddress> {
  checkCancelled(signal);
  try {
    return await resolveSocketAddress(
      url.hostname.replace(/^\[|\]$/g, ''),
      signal,
      assertPublicAddress,
    );
  } catch (cause) {
    checkCancelled(signal);
    if (cause instanceof SandboxError && cause.code === 'DNS_FAILED')
      throw new ToolError('DNS_FAILED', 'The web hostname could not be resolved', { cause });
    throw cause;
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
async function requestWebUrl(
  url: URL,
  method: string,
  body: string | undefined,
  contentType: string,
  signal: AbortSignal,
  gateway?: WebFetchGatewayAccess,
): Promise<WebResponse> {
  const selected = gateway ? { address: '127.0.0.1', family: 4 } : await publicAddress(url, signal);
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
        lookup: createPinnedLookup(selected),
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

/** Raw HTTP owns its deadline and redirect policy, including the exact read-only gateway exception. */
export async function fetchRawWeb(
  input: RawWebRequest,
  caller: AbortSignal,
  access?: WebFetchGatewayAccess,
): Promise<RawWebResponse> {
  const signal = AbortSignal.any([caller, AbortSignal.timeout(15_000)]);
  const gatewayUrl = gatewayTarget(input.url, access);
  const gateway = gatewayUrl === undefined ? undefined : access;
  let url = gatewayUrl ?? parseWebUrl(input.url);
  if (gateway !== undefined && (input.method !== 'GET' || input.body !== undefined))
    throw new ToolError('READ_ONLY', 'Plugin gateways accept read-only GET requests only');
  for (let redirects = 0; ; redirects += 1) {
    checkCancelled(signal);
    const response = await requestWebUrl(
      url,
      input.method,
      input.body,
      input.contentType,
      signal,
      gateway,
    );
    if (response.status < 300 || response.status >= 400 || response.location === undefined)
      return { url, status: response.status, text: response.text };
    if (gateway !== undefined)
      throw new ToolError('UNSAFE_REDIRECT', 'Plugin gateway redirects are not followed');
    const target = parseWebUrl(new URL(response.location, url).href);
    if (url.protocol === 'https:' && target.protocol === 'http:')
      throw new ToolError('UNSAFE_REDIRECT', 'HTTPS redirects cannot downgrade to HTTP');
    if (input.method !== 'GET')
      return { url, status: response.status, text: response.text, redirectUrl: target.href };
    if (redirects === 4)
      throw new ToolError('REDIRECT_LIMIT', 'Web request exceeded its redirect limit');
    url = target;
  }
}
