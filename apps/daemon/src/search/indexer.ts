import { setImmediate as nextTurn } from 'node:timers/promises';
import type { ProfileStore } from '@my-pi-harness/storage';
import type { SearchModelStatus } from '@my-pi-harness/protocol';
import type { SearchSourceSnapshot } from '@my-pi-harness/protocol/internal';
import type { LocalEmbeddingView } from './local-model-resource';
import { CHUNK_SIGNATURE, documentTerms, textChunks, tokenChunks, type TextChunk } from './text';

export interface SearchIndexerOptions {
  store: ProfileStore;
  embedding: Pick<LocalEmbeddingView, 'status' | 'tokenCounts' | 'embed'>;
  onError(error: unknown): void;
}

interface IndexPass {
  generation: number;
  signature: string;
  model: SearchModelStatus;
  semantic: boolean;
  signal: AbortSignal;
}

const SCAN_INTERVAL_MS = 2000;
const BACKGROUND_BATCH_SIZE = 4;

/** Readiness changed while derived work was pending; a later pass chooses a fresh generation. */
class IndexResourceChanged extends Error {}

function isAborted(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Derived work is owned by the daemon and may be cancelled without changing source facts. */
export class SearchIndexer {
  private readonly controller = new AbortController();
  private current: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | undefined;
  private lastKey = '';
  private closed = false;
  private rebuilding = false;

  public constructor(private readonly options: SearchIndexerOptions) {}

  public start(): void {
    this.wake();
  }

  public wake(): void {
    if (this.closed) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending) return;
    const controller = new AbortController();
    this.current = controller;
    const operation = this.refresh(AbortSignal.any([this.controller.signal, controller.signal]));
    this.pending = operation;
    void operation.then(
      () => this.finished(operation),
      (error: unknown) => {
        if (!isAborted(error) && !(error instanceof IndexResourceChanged))
          this.options.onError(error);
        this.finished(operation);
      },
    );
  }

  private finished(operation: Promise<void>): void {
    if (this.pending === operation) {
      this.pending = undefined;
      this.current = undefined;
    }
    if (this.closed) return;
    if (this.rebuilding && this.options.embedding.status().state !== 'preparing')
      queueMicrotask(() => this.wake());
    else this.timer = setTimeout(() => this.wake(), SCAN_INTERVAL_MS);
  }

  public rebuild(): void {
    if (this.closed) throw new Error('Search index is closed');
    const current = this.options.store.search.status();
    if (this.rebuilding || (current.buildingGeneration !== null && current.state !== 'failed')) {
      this.wake();
      return;
    }
    this.rebuilding = true;
    this.lastKey = '';
    this.current?.abort();
    this.wake();
  }

  private async refresh(signal: AbortSignal): Promise<void> {
    const { store, embedding } = this.options;
    if (!store.auth.profileOwner()) return;
    const repository = store.search;
    const model = embedding.status();
    const semanticSignature = `${CHUNK_SIGNATURE}:${model.signature}`;
    const semantic = model.state === 'ready';
    const signature = `${CHUNK_SIGNATURE}:${semantic ? model.signature : 'lexical'}`;
    const key = `${repository.watermark()}:${signature}`;
    if (key === this.lastKey && !this.rebuilding) {
      const readiness = repository.queryReadiness(semantic ? model.signature : undefined);
      if (readiness.complete && (!semantic || readiness.vectorsComplete === true)) return;
    }
    const state = repository.status(model.signature);
    if (
      model.state === 'preparing' &&
      repository.generationSignature(state.buildingGeneration ?? state.generation) ===
        semanticSignature
    )
      return;
    this.lastKey = '';
    let generation = state.buildingGeneration ?? state.generation;
    const existingSignature = repository.generationSignature(generation);
    if (this.rebuilding || (existingSignature !== signature && existingSignature !== 'unprepared'))
      generation = repository.beginRebuild(signature);
    this.rebuilding = false;
    const pass: IndexPass = { generation, signature, model, semantic, signal };
    try {
      repository.setFailure(null);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const watermark = repository.watermark();
        let cursor: string | undefined;
        do {
          signal.throwIfAborted();
          this.assertResource(pass);
          const page = repository.sources({
            ...(cursor === undefined ? {} : { after: cursor }),
            limit: 16,
          });
          for (const source of page.items) {
            await this.indexSource(source, pass);
            await nextTurn(undefined, { signal });
          }
          cursor = page.next ?? undefined;
        } while (cursor !== undefined);
        this.assertResource(pass);
        signal.throwIfAborted();
        if (repository.activate(generation, watermark)) {
          this.lastKey = `${watermark}:${signature}`;
          while (repository.collectInactive(16, semantic ? undefined : semanticSignature) > 0)
            await nextTurn(undefined, { signal });
          return;
        }
      }
    } catch (error) {
      if (!isAborted(error) && !(error instanceof IndexResourceChanged))
        repository.setFailure('索引更新失败，可重建派生索引；记忆与对话原文保留。');
      throw error;
    }
  }

  private assertResource(pass: IndexPass): void {
    const current = this.options.embedding.status();
    if (
      (current.state === 'ready') !== pass.semantic ||
      (pass.semantic && current.signature !== pass.model.signature)
    )
      throw new IndexResourceChanged('Embedding resource changed during index preparation');
  }

  private async indexSource(source: SearchSourceSnapshot, pass: IndexPass): Promise<void> {
    const repository = this.options.store.search;
    const { embedding } = this.options;
    const { generation, signature, model, signal } = pass;
    let indexed = repository.indexed(
      source.source,
      generation,
      signature,
      pass.semantic ? model.signature : undefined,
    );
    if (!indexed.chunks) {
      repository.reuseSource(source.source, generation, signature);
      indexed = repository.indexed(
        source.source,
        generation,
        signature,
        pass.semantic ? model.signature : undefined,
      );
    }
    if (indexed.chunks && (!pass.semantic || indexed.vectors)) return;
    if (!indexed.chunks) {
      let chunks: TextChunk[];
      if (pass.semantic) {
        try {
          chunks = await tokenChunks(
            source.text,
            (texts, tokenSignal) =>
              embedding.tokenCounts(texts, {
                kind: 'passage',
                priority: 'background',
                signal: tokenSignal,
              }),
            signal,
          );
        } catch (error) {
          this.assertResource(pass);
          throw error;
        }
      } else chunks = textChunks(source.text);
      signal.throwIfAborted();
      this.assertResource(pass);
      if (
        !repository.replaceChunks({
          generation,
          source: source.source,
          signature,
          chunks: this.records(chunks),
        })
      )
        return;
    }
    if (!pass.semantic) return;
    for (;;) {
      signal.throwIfAborted();
      this.assertResource(pass);
      const batch = repository.pendingVectorChunks(
        source.source,
        generation,
        signature,
        model.signature,
        { limit: BACKGROUND_BATCH_SIZE },
      );
      if (batch.length === 0) return;
      let vectors: readonly (readonly number[])[];
      try {
        vectors = await embedding.embed(
          batch.map((chunk) => chunk.text),
          { kind: 'passage', priority: 'background', signal },
        );
      } catch (error) {
        this.assertResource(pass);
        throw error;
      }
      signal.throwIfAborted();
      this.assertResource(pass);
      const written = repository.putVectors({
        generation,
        source: source.source,
        signature,
        modelSignature: model.signature,
        dimensions: model.dimensions,
        vectors: batch.map((chunk, index) => {
          const vector = vectors[index];
          if (!vector) throw new Error('Embedding resource returned an incomplete batch');
          return { ordinal: chunk.ordinal, vector };
        }),
      });
      if (!written) return;
    }
  }

  private records(chunks: readonly TextChunk[]) {
    return chunks.map((chunk) => ({ ...chunk, tokens: documentTerms(chunk.text) }));
  }

  public async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      if (this.timer !== undefined) clearTimeout(this.timer);
      this.controller.abort();
    }
    try {
      await this.pending;
    } catch (error) {
      if (!isAborted(error)) throw error;
    }
  }
}
