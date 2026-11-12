import { isPublicAddress, resolveSocketAddress } from '@my-pi-harness/sandbox/network';
import { isIP } from 'node:net';
import { WebServiceError } from './errors';

const credentialQuery =
  /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|password|secret)$/i;
const explicitUrl = /https?:\/\/[^\s<>"'`]+/gi;

function publicUrlReference(url: URL): string {
  if (
    url.username !== '' ||
    url.password !== '' ||
    [...url.searchParams.keys()].some((key) => credentialQuery.test(key))
  )
    throw new WebServiceError('WEB_INVALID_URL', '联网请求不能携带 URL 认证信息。');
  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (
    hostname === 'localhost' ||
    ['.localhost', '.local', '.internal'].some((suffix) => hostname.endsWith(suffix)) ||
    (isIP(hostname) !== 0 && !isPublicAddress(hostname))
  )
    throw new WebServiceError('WEB_PRIVATE_NETWORK', '联网服务不能接收本机或私有网络地址。');
  return hostname;
}

function searchReference(input: string): URL | undefined {
  let reference = input.replace(/[.,;:!?，。；：！？)）}”’]+$/u, '');
  for (;;) {
    try {
      return new URL(reference);
    } catch {
      // A closing bracket may delimit Markdown or belong to a valid IPv6 literal.
      if (!reference.endsWith(']')) return undefined;
      reference = reference.slice(0, -1).replace(/[.,;:!?，。；：！？)）}”’]+$/u, '');
    }
  }
}

/** Reject recognizable private URL references, without interpreting general query text or resolving example domains. */
export function assertPublicSearchReferences(input: string): void {
  for (const match of input.matchAll(explicitUrl)) {
    const url = searchReference(match[0]);
    if (url !== undefined) publicUrlReference(url);
  }
}

/** A page URL is sent to a third party only after every local DNS answer is public. */
export async function publicPageTarget(input: string, signal: AbortSignal): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new WebServiceError('WEB_INVALID_URL', '网页地址无效。');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.port !== '' ||
    url.hostname === ''
  )
    throw new WebServiceError(
      'WEB_INVALID_URL',
      '网页地址必须使用 HTTP(S) 标准端口，且不能携带认证信息。',
    );
  const hostname = publicUrlReference(url);
  await resolveSocketAddress(hostname, signal, (address) => {
    if (!isPublicAddress(address))
      throw new WebServiceError('WEB_PRIVATE_NETWORK', '联网服务不能访问本机或私有网络地址。');
  });
  signal.throwIfAborted();
  url.hash = '';
  return url;
}
