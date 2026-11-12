import type { ToolSearchEmbedder } from '@my-pi-harness/tools';
import { LocalModelError, type LocalEmbeddingView } from './local-model-resource';

/** Tool catalogs retain lexical fallback while consuming only the shared embedding view. */
export class LocalToolSearchEmbedder implements ToolSearchEmbedder {
  public constructor(private readonly resource: LocalEmbeddingView) {}
  public embed(
    purpose: 'document' | 'query',
    inputs: readonly string[],
    signal: AbortSignal,
  ): Promise<readonly (readonly number[])[]> {
    signal.throwIfAborted();
    if (this.resource.status().state !== 'ready')
      return Promise.reject(
        new LocalModelError(
          'SEARCH_MODEL_NOT_PREPARED',
          'Local embedding model is not ready; lexical tool retrieval remains available',
        ),
      );
    return this.resource.embed(inputs, {
      kind: purpose === 'query' ? 'query' : 'passage',
      priority: 'tool',
      signal,
    });
  }
}
