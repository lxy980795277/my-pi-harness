import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { WebSearchInput } from '@my-pi-harness/protocol';
import type {
  WebSearchResult,
  WebPageInput,
  WebPageResult,
} from '@my-pi-harness/protocol/internal';
import { createRemoteFetch, type RemoteFetch } from '../network/remote-fetch';
import { WebServiceError, webHttpFailure, webNetworkFailure } from './errors';
import { assertPublicSearchReferences, publicPageTarget } from './target';

export interface DeepSeekWebClientOptions {
  /** Explicit host test injection; production always targets the fixed official origin. */
  fetch?: RemoteFetch;
}
type SearchResponse = Static<typeof searchResponse>;

const origin = 'https://api.deepseek.com';
const maximumResponseBytes = 4 * 1024 * 1024;
const nullableText = Type.Union([Type.String({ maxLength: 8192 }), Type.Null()]);
const searchResponse = Type.Object({
  results: Type.Array(
    Type.Object({
      title: Type.String({ maxLength: 8192 }),
      url: Type.String({ minLength: 1, maxLength: 8192 }),
      snippet: Type.String({ maxLength: 100_000 }),
      summary: Type.String({ maxLength: 500_000 }),
      content: Type.String({ maxLength: maximumResponseBytes }),
      site_name: nullableText,
      site_icon: nullableText,
      date: Type.Union([
        Type.String({
          maxLength: 64,
          pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|\\+00:00)$',
        }),
        Type.Null(),
      ]),
      rerank_score: Type.Number({ minimum: 0, maximum: 3 }),
      authority: Type.Integer({ minimum: -1, maximum: 4 }),
    }),
    { maxItems: 50 },
  ),
});
const pageResponse = Type.Object({
  title: Type.String({ maxLength: 8192 }),
  content: Type.String({ maxLength: maximumResponseBytes }),
});

async function cancelBody(
  body: ReadableStream<unknown> | ReadableStreamDefaultReader<unknown> | null,
): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // Cleanup cannot replace the response or cancellation error selected by the caller.
  }
}

/** Read bounded, strict UTF-8 JSON even when a test substitutes the transport. */
async function responseJson(
  response: Response,
  signal: AbortSignal,
  key: string,
): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await cancelBody(response.body);
    throw new WebServiceError('WEB_INVALID_RESPONSE', 'DeepSeek 联网服务没有返回 JSON 数据。');
  }
  if (response.body === null)
    throw new WebServiceError('WEB_INVALID_RESPONSE', 'DeepSeek 联网服务返回了空响应。');
  const reader: ReadableStreamDefaultReader<unknown> = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let content = '';
  let cancellation: Promise<void> | undefined;
  const cancel = (): void => {
    cancellation = cancelBody(reader);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      const chunk = part.value;
      if (!(chunk instanceof Uint8Array))
        throw new WebServiceError('WEB_INVALID_RESPONSE', 'DeepSeek 联网响应不是字节流。');
      bytes += chunk.byteLength;
      if (bytes > maximumResponseBytes)
        throw new WebServiceError('WEB_RESPONSE_LIMIT', 'DeepSeek 联网响应超过大小限制。');
      content += decoder.decode(chunk, { stream: true });
    }
    content += decoder.decode();
    const value: unknown = JSON.parse(content);
    if (JSON.stringify(value).includes(key))
      throw new WebServiceError('WEB_INVALID_RESPONSE', 'DeepSeek 联网响应包含受保护的认证信息。');
    return value;
  } catch (error) {
    await cancelBody(reader);
    if (error instanceof SyntaxError || error instanceof TypeError)
      throw new WebServiceError(
        'WEB_INVALID_RESPONSE',
        'DeepSeek 联网服务返回了无效 JSON 或 UTF-8 数据。',
      );
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    await cancellation;
    reader.releaseLock();
  }
}

function searchResult(response: SearchResponse): WebSearchResult {
  return {
    results: response.results.map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      summary: result.summary,
      content: result.content,
      siteName: result.site_name,
      siteIcon: result.site_icon,
      date: result.date,
      rerankScore: result.rerank_score,
      authority: result.authority,
    })),
  };
}

/** Official Search/Fetch APIs are read operations despite their POST transport; no chat key or endpoint is inferred. */
export class DeepSeekWebClient {
  private readonly request: RemoteFetch;

  public constructor(options: DeepSeekWebClientOptions = {}) {
    this.request =
      options.fetch ??
      createRemoteFetch({
        allowedOrigins: new Set([origin]),
        maximumResponseBytes,
      });
  }

  public async search(
    input: WebSearchInput,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<WebSearchResult> {
    const owned = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
    try {
      owned.throwIfAborted();
      assertPublicSearchReferences(input.query);
      if (input.oriQuestion !== undefined) assertPublicSearchReferences(input.oriQuestion);
      const response = await this.post(
        '/v1/tools/search',
        {
          query: input.query,
          count: input.count ?? 10,
          need_content: input.needContent ?? false,
          ...(input.oriQuestion === undefined ? {} : { ori_question: input.oriQuestion }),
          ...(input.localization === undefined ? {} : { localization: input.localization }),
        },
        apiKey,
        owned,
      );
      if (!Value.Check(searchResponse, response))
        throw new WebServiceError('WEB_INVALID_RESPONSE', 'DeepSeek 搜索结果字段无效。');
      return searchResult(response);
    } catch (error) {
      throw webNetworkFailure(error, owned);
    }
  }

  public async fetchPage(
    input: WebPageInput,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<WebPageResult> {
    const owned = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
    try {
      const url = await publicPageTarget(input.url, owned);
      const response = await this.post('/v1/tools/fetch', { url: url.toString() }, apiKey, owned);
      if (!Value.Check(pageResponse, response))
        throw new WebServiceError('WEB_INVALID_RESPONSE', 'DeepSeek 网页正文数据无效。');
      return { url: url.toString(), title: response.title, content: response.content };
    } catch (error) {
      throw webNetworkFailure(error, owned);
    }
  }

  private async post(
    path: string,
    input: object,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    const response = await this.request(`${origin}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(input),
      redirect: 'error',
      signal,
    });
    if (signal.aborted) {
      await cancelBody(response.body);
      signal.throwIfAborted();
    }
    if (response.status !== 200) {
      await cancelBody(response.body);
      throw webHttpFailure(response.status);
    }
    return await responseJson(response, signal, apiKey);
  }
}
