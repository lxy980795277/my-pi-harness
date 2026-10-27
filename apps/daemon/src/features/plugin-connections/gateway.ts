import { SkillError, type PluginConnectionDefinition } from '@my-pi-harness/integrations';

export interface PluginGatewayResponse {
  body: Buffer;
  contentType: string;
  statusCode: number;
}

const MAXIMUM_RESPONSE_BYTES = 5 * 1024 * 1024;

function matches(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => new RegExp(pattern).test(path));
}

function targetUrl(definition: PluginConnectionDefinition, path: string, search: string): URL {
  const base = new URL(definition.apiUrl);
  const target = new URL(`/${path.replace(/^\/+/, '')}`, base);
  target.search = search;
  if (
    target.origin !== base.origin ||
    !matches(definition.gateway.allowedPaths, target.pathname) ||
    !Object.entries(definition.gateway.deniedQueryValues ?? {}).every(([key, values]) =>
      target.searchParams.getAll(key).every((value) => !values.includes(value)),
    )
  )
    throw new SkillError('SKILL_GATEWAY_PATH_INVALID', '此服务路径不在插件的只读访问范围中。');
  return target;
}

async function readBody(response: Response, signal: AbortSignal): Promise<Buffer> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAXIMUM_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new SkillError('SKILL_GATEWAY_UPSTREAM_FAILED', '插件网关响应超过 5 MiB。');
  }
  if (response.body === null) return Buffer.alloc(0);
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAXIMUM_RESPONSE_BYTES)
        throw new SkillError('SKILL_GATEWAY_UPSTREAM_FAILED', '插件网关响应超过 5 MiB。');
      chunks.push(result.value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

/** Forward a manifest-approved read, with credentials confined to the fixed upstream origin. */
export async function requestPluginGateway(
  definition: PluginConnectionDefinition,
  accessToken: string | undefined,
  path: string,
  search: string,
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<PluginGatewayResponse> {
  const target = targetUrl(definition, path, search);
  const timeout = AbortSignal.timeout(10_000);
  const ownedSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  ownedSignal.throwIfAborted();
  const postQuery = matches(definition.gateway.queryJsonPostPaths ?? [], target.pathname);
  let body: string | undefined;
  if (postQuery) {
    const query = target.searchParams.get('query');
    body = JSON.stringify(query === null ? {} : { query });
    target.search = '';
  }
  let response: Response;
  try {
    response = await request(target, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body }),
      headers: {
        Accept: '*/*',
        ...definition.gateway.headers,
        ...(accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` }),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'User-Agent': 'my-pi-harness-skill-gateway',
      },
      redirect: 'error',
      signal: ownedSignal,
    });
    const responseBody = await readBody(response, ownedSignal);
    return {
      body: responseBody,
      contentType: response.headers.get('content-type') ?? 'application/json',
      statusCode: response.status,
    };
  } catch (error: unknown) {
    if (error instanceof SkillError) throw error;
    ownedSignal.throwIfAborted();
    throw new SkillError('SKILL_GATEWAY_UPSTREAM_FAILED', '插件网关无法读取上游服务。');
  }
}
