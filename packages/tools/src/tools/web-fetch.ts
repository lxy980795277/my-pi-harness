import { Type } from 'typebox';
import { checkCancelled } from '@my-pi-harness/sandbox';
import { gatewayTarget, parseWebUrl, requestWebUrl } from '../lib/web-request';
import { ToolError, completeToolRegistration, strictObjectSchema } from '../lib/tool-registry';

const parameters = strictObjectSchema({
  url: Type.String({ minLength: 1, maxLength: 4096 }),
  method: Type.Optional(Type.Union([Type.Literal('GET'), Type.Literal('POST')])),
  body: Type.Optional(Type.String({ maxLength: 250000 })),
  contentType: Type.Optional(
    Type.Union([
      Type.Literal('application/json'),
      Type.Literal('text/plain'),
      Type.Literal('application/x-www-form-urlencoded'),
    ]),
  ),
});

/** Fetch bounded text without cookies, ambient proxies, retries or unchecked redirects. */
export const webFetchTool = completeToolRegistration({
  name: 'web_fetch',
  description:
    'Fetch a public HTTP(S) URL as bounded text. Private addresses and unsafe redirects are denied. Only the exact authorized local Skill gateway is exempt. POST requires approval.',
  parameters,
  scope: 'session',
  loading: 'default',
  readOnly: true,
  policy: (args) => ({
    summary: `web_fetch: ${args.url.slice(0, 300)}`,
    approvalRequired: true,
    mutating: args.method === 'POST',
  }),
  async execute(ports, args, invocation) {
    const method = args.method ?? 'GET';
    if (method !== 'POST' && args.body !== undefined)
      throw new ToolError('INVALID_ARGUMENTS', 'A request body requires POST');
    if (ports.readOnly && method !== 'GET')
      throw new ToolError('READ_ONLY', 'Network writes are disabled by the current policy');
    const signal = AbortSignal.any([invocation.signal, AbortSignal.timeout(15_000)]);
    const input = args.url;
    const gatewayUrl = gatewayTarget(input, ports.skillGateway);
    const gateway = gatewayUrl === undefined ? undefined : ports.skillGateway;
    let url = gatewayUrl ?? parseWebUrl(input);
    if (gateway !== undefined && (method !== 'GET' || args.body !== undefined))
      throw new ToolError('READ_ONLY', 'Plugin gateways accept read-only GET requests only');
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      checkCancelled(signal);
      const response = await requestWebUrl(
        url,
        method,
        args.body,
        args.contentType ?? 'text/plain',
        signal,
        gateway,
      );
      if (response.status >= 300 && response.status < 400 && response.location !== undefined) {
        if (gateway !== undefined)
          throw new ToolError('UNSAFE_REDIRECT', 'Plugin gateway redirects are not followed');
        const target = parseWebUrl(new URL(response.location, url).href);
        if (url.protocol === 'https:' && target.protocol === 'http:')
          throw new ToolError('UNSAFE_REDIRECT', 'HTTPS redirects cannot downgrade to HTTP');
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
          throw new ToolError('REDIRECT_LIMIT', 'Web request exceeded its redirect limit');
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
    throw new ToolError('REDIRECT_LIMIT', 'Web request exceeded its redirect limit');
  },
});
