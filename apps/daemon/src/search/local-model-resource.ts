import { Worker } from 'node:worker_threads';
import { isAbsolute, join } from 'node:path';
import { statSync } from 'node:fs';
import { Value } from 'typebox/value';
import type { SearchModelStatus, SearchRerankerStatus } from '@my-pi-harness/protocol';
import { LOCAL_MODEL_WORKER } from './local-model-worker';
import { LOCAL_EMBEDDING_MODEL } from './embedding-model';
import { LOCAL_RERANKER_MODEL } from './reranker-model';
import {
  EMBEDDING_BACKGROUND_BATCH_SIZE,
  EMBEDDING_BATCH_SIZE,
  RERANK_BATCH_SIZE,
  LocalModelReplySchema,
  type EmbeddingKind,
  type LocalModelKind,
  type LocalModelOperation,
  type LocalModelPriority,
  type LocalModelReply,
} from './local-model-protocol';

export type { EmbeddingKind, LocalModelPriority } from './local-model-protocol';

export interface LocalSearchModelResourceOptions {
  cacheDirectory: string;
  /** Explicit host test injection; never accepted from model or HTTP input. */
  moduleUrl?: string;
}

export interface LocalModelRequestOptions {
  priority: LocalModelPriority;
  signal: AbortSignal;
}

export interface EmbeddingRequestOptions extends LocalModelRequestOptions {
  kind: EmbeddingKind;
}

export interface LocalEmbeddingView {
  status(): SearchModelStatus;
  prepare(signal: AbortSignal): Promise<void>;
  tokenCounts(texts: readonly string[], options: EmbeddingRequestOptions): Promise<number[]>;
  embed(
    texts: readonly string[],
    options: EmbeddingRequestOptions,
  ): Promise<readonly (readonly number[])[]>;
}

export interface LocalRerankerView {
  status(): SearchRerankerStatus;
  prepare(signal: AbortSignal): Promise<void>;
  /** A null score identifies only a complete pair exceeding 512 actual tokens. */
  rerank(
    query: string,
    passages: readonly string[],
    options: LocalModelRequestOptions,
  ): Promise<readonly (number | null)[]>;
}

interface ModelState {
  state: SearchModelStatus['state'];
  progress: SearchModelStatus['progress'];
  error: SearchModelStatus['error'];
  preparation?: Promise<void>;
}

interface Job {
  id: number;
  model: LocalModelKind;
  operation: LocalModelOperation;
  kind: EmbeddingKind;
  query: string;
  inputs: readonly string[];
  priority: LocalModelPriority;
  signal: AbortSignal;
  abort(this: void): void;
  cancelled: boolean;
  callerSettled: boolean;
  resolve(this: void, value: LocalModelReply): void;
  reject(this: void, error: Error): void;
}

export type LocalModelErrorCode =
  | 'SEARCH_MODEL_NOT_PREPARED'
  | 'SEARCH_MODEL_TOKEN_LIMIT'
  | 'SEARCH_MODEL_UNAVAILABLE'
  | 'SEARCH_MODEL_CLOSED'
  | 'SEARCH_MODEL_QUEUE_FULL'
  | 'SEARCH_MODEL_BUSY';

const MODEL_SPECS = { embedding: LOCAL_EMBEDDING_MODEL, reranker: LOCAL_RERANKER_MODEL };
const MODEL_KINDS: readonly LocalModelKind[] = ['embedding', 'reranker'];
const MAX_QUEUED_BATCHES = 64;
const MAX_INPUTS = 512;
const MAX_INPUT_CHARACTERS = 16_000;
const FOREGROUND_BURST = 8;
const TOOL_BURST = 4;

/** Public diagnostics exclude loader paths, environment values and native backend errors. */
export class LocalModelError extends Error {
  public constructor(
    public readonly code: LocalModelErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function cancelled(): DOMException {
  return new DOMException('Local model operation cancelled', 'AbortError');
}
function unavailable(): LocalModelError {
  return new LocalModelError('SEARCH_MODEL_UNAVAILABLE', 'Local model resource is unavailable');
}
function busy(): LocalModelError {
  return new LocalModelError(
    'SEARCH_MODEL_BUSY',
    'Explicit model preparation is occupying the local worker',
  );
}

/** Two fixed model views share one priority queue and one Worker with actual-settlement capacity. */
export class LocalSearchModelResource {
  public readonly embedding: LocalEmbeddingView;
  public readonly reranker: LocalRerankerView;
  private readonly models: Record<LocalModelKind, ModelState>;
  private worker: Worker | undefined;
  private readonly waiting: Job[] = [];
  private active: Job | undefined;
  private serial = 0;
  private foregroundBurst = 0;
  private toolBurst = 0;
  private closed = false;
  private closing: Promise<void> | undefined;
  private terminating: Promise<void> | undefined;

  public constructor(private readonly options: LocalSearchModelResourceOptions) {
    if (!isAbsolute(options.cacheDirectory)) throw new Error('Local model cache must be absolute');
    this.models = {
      embedding: this.cacheState('embedding'),
      reranker: this.cacheState('reranker'),
    };
    this.embedding = {
      status: () => ({
        ...this.status('embedding'),
        dimensions: LOCAL_EMBEDDING_MODEL.dimensions,
      }),
      prepare: (signal) => this.prepare('embedding', signal),
      tokenCounts: (texts, options) => this.tokenCounts(texts, options),
      embed: (texts, options) => this.embed(texts, options),
    };
    this.reranker = {
      status: () => this.status('reranker'),
      prepare: (signal) => this.prepare('reranker', signal),
      rerank: (query, passages, options) => this.rerank(query, passages, options),
    };
  }

  /** Shutdown rejects waiters and waits for the owned Worker or a pending termination. */
  public close(): Promise<void> {
    this.closing ??= this.stop();
    return this.closing;
  }

  private status(model: LocalModelKind): SearchRerankerStatus {
    const spec = MODEL_SPECS[model];
    const status = this.models[model];
    return {
      state: status.state,
      modelId: spec.modelId,
      revision: spec.revision,
      signature: spec.signature,
      maxInputTokens: spec.maxInputTokens,
      progress: status.progress === null ? null : { ...status.progress },
      error: status.error,
    };
  }

  private prepare(model: LocalModelKind, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.assertOpen();
    const status = this.models[model];
    if (status.preparation) return status.preparation;
    status.state = 'preparing';
    status.progress = null;
    status.error = null;
    const preparation = this.enqueue(model, 'prepare', [], {
      kind: 'passage',
      priority: 'foreground',
      signal,
    })
      .then(() => undefined)
      .finally(() => {
        if (status.preparation === preparation) delete status.preparation;
        if (
          !this.closed &&
          status.state === 'preparing' &&
          !(this.active?.model === model && this.active.operation === 'prepare') &&
          !this.waiting.some((job) => job.model === model && job.operation === 'prepare')
        )
          Object.assign(status, this.cacheState(model));
      });
    status.preparation = preparation;
    return preparation;
  }

  private async tokenCounts(
    texts: readonly string[],
    options: EmbeddingRequestOptions,
  ): Promise<number[]> {
    this.validate(texts, options.signal);
    const counts: number[] = [];
    const size =
      options.priority === 'background' ? EMBEDDING_BACKGROUND_BATCH_SIZE : EMBEDDING_BATCH_SIZE;
    for (let offset = 0; offset < texts.length; offset += size) {
      const result = await this.enqueue(
        'embedding',
        'tokens',
        texts.slice(offset, offset + size),
        options,
      );
      if (result.type !== 'settled' || result.status !== 'tokens') throw unavailable();
      counts.push(...result.counts);
    }
    return counts;
  }

  private async embed(
    texts: readonly string[],
    options: EmbeddingRequestOptions,
  ): Promise<readonly (readonly number[])[]> {
    this.validate(texts, options.signal);
    const vectors: (readonly number[])[] = [];
    const size =
      options.priority === 'background' ? EMBEDDING_BACKGROUND_BATCH_SIZE : EMBEDDING_BATCH_SIZE;
    for (let offset = 0; offset < texts.length; offset += size) {
      const result = await this.enqueue(
        'embedding',
        'embed',
        texts.slice(offset, offset + size),
        options,
      );
      if (result.type !== 'settled' || result.status !== 'vectors') throw unavailable();
      vectors.push(...result.vectors);
    }
    return vectors;
  }

  private async rerank(
    query: string,
    passages: readonly string[],
    options: LocalModelRequestOptions,
  ): Promise<readonly (number | null)[]> {
    this.validate(passages, options.signal);
    this.validate([query], options.signal);
    const scores: (number | null)[] = [];
    for (let offset = 0; offset < passages.length; offset += RERANK_BATCH_SIZE) {
      const result = await this.enqueue(
        'reranker',
        'rerank',
        passages.slice(offset, offset + RERANK_BATCH_SIZE),
        { ...options, kind: 'passage' },
        query,
      );
      if (result.type !== 'settled' || result.status !== 'scores') throw unavailable();
      scores.push(...result.scores);
    }
    return scores;
  }

  private cacheState(model: LocalModelKind): ModelState {
    const spec = MODEL_SPECS[model];
    try {
      const exists = spec.files.every((file) => {
        try {
          const stat = statSync(
            join(this.options.cacheDirectory, spec.modelId, spec.revision, file),
          );
          return stat.isFile() && stat.size > 0;
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            (error.code === 'ENOENT' || error.code === 'ENOTDIR')
          )
            return false;
          throw error;
        }
      });
      return { state: exists ? 'ready' : 'unprepared', progress: null, error: null };
    } catch {
      return { state: 'unavailable', progress: null, error: 'LOCAL_MODEL_UNAVAILABLE' };
    }
  }

  private validate(texts: readonly string[], signal: AbortSignal): void {
    signal.throwIfAborted();
    this.assertOpen();
    if (texts.length > MAX_INPUTS || texts.some((text) => text.length > MAX_INPUT_CHARACTERS))
      throw new LocalModelError(
        'SEARCH_MODEL_TOKEN_LIMIT',
        'Local model text batch exceeds its bounded input limit',
      );
  }

  private assertOpen(): void {
    if (this.closed)
      throw new LocalModelError('SEARCH_MODEL_CLOSED', 'Local model resource is closed');
  }

  private enqueue(
    model: LocalModelKind,
    operation: LocalModelOperation,
    inputs: readonly string[],
    options: EmbeddingRequestOptions,
    query = '',
  ): Promise<LocalModelReply> {
    options.signal.throwIfAborted();
    this.assertOpen();
    if (
      operation !== 'prepare' &&
      options.priority !== 'background' &&
      this.active?.operation === 'prepare'
    )
      return Promise.reject(busy());
    if (this.waiting.length >= MAX_QUEUED_BATCHES)
      return Promise.reject(
        new LocalModelError('SEARCH_MODEL_QUEUE_FULL', 'Local model queue is full'),
      );
    return new Promise((resolve, reject) => {
      const job: Job = {
        id: ++this.serial,
        model,
        operation,
        inputs,
        query,
        ...options,
        cancelled: false,
        callerSettled: false,
        resolve: (value) => {
          if (!job.callerSettled) {
            job.callerSettled = true;
            resolve(value);
          }
        },
        reject: (error) => {
          if (!job.callerSettled) {
            job.callerSettled = true;
            reject(error);
          }
        },
        abort: () => this.cancel(job),
      };
      this.waiting.push(job);
      options.signal.addEventListener('abort', job.abort, { once: true });
      if (options.signal.aborted) job.abort();
      this.drain();
    });
  }

  private choose(): Job | undefined {
    const foreground = this.waiting.findIndex((job) => job.priority === 'foreground');
    const tool = this.waiting.findIndex((job) => job.priority === 'tool');
    const background = this.waiting.findIndex((job) => job.priority === 'background');
    let index: number;
    if (background !== -1 && this.toolBurst >= TOOL_BURST) {
      index = background;
      this.foregroundBurst = 0;
      this.toolBurst = 0;
    } else if (
      foreground !== -1 &&
      (this.foregroundBurst < FOREGROUND_BURST || (tool === -1 && background === -1))
    ) {
      index = foreground;
      this.foregroundBurst += 1;
    } else if (tool !== -1 && (this.toolBurst < TOOL_BURST || background === -1)) {
      index = tool;
      this.foregroundBurst = 0;
      this.toolBurst += 1;
    } else if (background !== -1) {
      index = background;
      this.foregroundBurst = 0;
      this.toolBurst = 0;
    } else return undefined;
    return this.waiting.splice(index, 1)[0];
  }

  private drain(): void {
    if (this.closed || this.active || this.terminating) return;
    const job = this.choose();
    if (!job) return;
    this.active = job;
    try {
      if (job.operation === 'prepare') {
        this.models[job.model].state = 'preparing';
        for (const waiting of [...this.waiting]) {
          if (waiting.operation === 'prepare' || waiting.priority === 'background') continue;
          this.waiting.splice(this.waiting.indexOf(waiting), 1);
          waiting.signal.removeEventListener('abort', waiting.abort);
          waiting.reject(busy());
        }
      }
      this.start().postMessage({
        type: 'run',
        id: job.id,
        model: job.model,
        operation: job.operation,
        kind: job.kind,
        inputs: job.inputs,
        query: job.query,
      });
    } catch {
      this.failWorker();
    }
  }

  private start(): Worker {
    this.assertOpen();
    if (this.worker) return this.worker;
    const worker = new Worker(LOCAL_MODEL_WORKER, {
      eval: true,
      execArgv: [],
      workerData: {
        models: MODEL_SPECS,
        cacheDirectory: this.options.cacheDirectory,
        moduleUrl: this.options.moduleUrl ?? import.meta.resolve('@huggingface/transformers'),
      },
      env: { HF_HUB_DISABLE_TELEMETRY: '1' },
      stdout: true,
      stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 512, stackSizeMb: 8 },
    });
    worker.stdout.resume();
    worker.stderr.resume();
    worker.on('message', (reply: unknown) => {
      if (this.worker !== worker) return;
      if (!Value.Check(LocalModelReplySchema, reply)) {
        this.failWorker();
        return;
      }
      this.receive(reply);
    });
    worker.on('error', () => {
      if (this.worker === worker) this.failWorker();
    });
    worker.on('exit', () => {
      if (this.worker === worker) this.failWorker();
    });
    this.worker = worker;
    return worker;
  }

  private receive(reply: LocalModelReply): void {
    const job = this.active;
    if (!job || reply.id !== job.id) {
      this.failWorker();
      return;
    }
    const status = this.models[job.model];
    if (reply.type === 'progress') {
      if (job.operation === 'prepare' && !job.cancelled)
        status.progress = { loadedBytes: reply.loadedBytes, totalBytes: reply.totalBytes };
      return;
    }
    this.active = undefined;
    job.signal.removeEventListener('abort', job.abort);
    status.state = this.waiting.some(
      (entry) => entry.model === job.model && entry.operation === 'prepare',
    )
      ? 'preparing'
      : reply.ready
        ? 'ready'
        : 'unprepared';
    status.progress = null;
    status.error = null;
    if (job.cancelled || reply.status === 'cancelled') job.reject(cancelled());
    else if (reply.status === 'error') {
      const tokenLimit = reply.error === 'TOKEN_LIMIT';
      if (!reply.ready && reply.error !== 'UNPREPARED') status.state = 'unavailable';
      status.error = tokenLimit
        ? null
        : job.operation === 'prepare'
          ? 'PREPARE_FAILED'
          : 'LOCAL_MODEL_UNAVAILABLE';
      job.reject(
        new LocalModelError(
          tokenLimit
            ? 'SEARCH_MODEL_TOKEN_LIMIT'
            : reply.error === 'UNPREPARED'
              ? 'SEARCH_MODEL_NOT_PREPARED'
              : 'SEARCH_MODEL_UNAVAILABLE',
          tokenLimit
            ? 'Local model input exceeds 512 tokens including special tokens'
            : 'Local model must be prepared before semantic retrieval',
        ),
      );
    } else if (
      (reply.status === 'vectors' &&
        (job.operation !== 'embed' ||
          reply.vectors.length !== job.inputs.length ||
          reply.vectors.some(
            (vector) =>
              vector.some((value) => !Number.isFinite(value)) || Math.hypot(...vector) === 0,
          ))) ||
      (reply.status === 'tokens' &&
        (job.operation !== 'tokens' || reply.counts.length !== job.inputs.length)) ||
      (reply.status === 'scores' &&
        (job.operation !== 'rerank' ||
          reply.scores.length !== job.inputs.length ||
          reply.scores.some((score) => score !== null && !Number.isFinite(score)))) ||
      (reply.status === 'prepared' && job.operation !== 'prepare') ||
      !reply.ready
    ) {
      job.reject(unavailable());
      this.failWorker();
      return;
    } else job.resolve(reply);
    this.drain();
  }

  private cancel(job: Job): void {
    job.cancelled = true;
    job.signal.removeEventListener('abort', job.abort);
    const index = this.waiting.indexOf(job);
    if (index !== -1) {
      this.waiting.splice(index, 1);
      if (job.operation === 'prepare')
        Object.assign(this.models[job.model], this.cacheState(job.model));
      job.reject(cancelled());
      return;
    }
    if (this.active !== job) return;
    if (job.operation === 'prepare') {
      void this.cancelPreparation(job);
      return;
    }
    job.reject(cancelled());
    this.worker?.postMessage({ type: 'cancel', id: job.id });
  }

  private async cancelPreparation(job: Job): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    try {
      if (worker) await this.terminate(worker);
    } catch {
      this.failWorker();
      return;
    }
    if (this.active === job) this.active = undefined;
    if (!this.closed) {
      for (const model of MODEL_KINDS) {
        Object.assign(this.models[model], this.cacheState(model));
        if (this.waiting.some((entry) => entry.model === model && entry.operation === 'prepare'))
          this.models[model].state = 'preparing';
      }
    }
    job.reject(cancelled());
    this.drain();
  }

  private terminate(worker: Worker): Promise<void> {
    const terminating = worker.terminate().then(() => undefined);
    this.terminating = terminating;
    return terminating.finally(() => {
      if (this.terminating === terminating) this.terminating = undefined;
      this.drain();
    });
  }

  private failWorker(): void {
    const worker = this.worker;
    this.worker = undefined;
    for (const model of MODEL_KINDS)
      Object.assign(this.models[model], {
        state: 'unavailable',
        progress: null,
        error: 'LOCAL_MODEL_UNAVAILABLE',
      });
    for (const job of [...this.waiting, ...(this.active ? [this.active] : [])]) {
      job.signal.removeEventListener('abort', job.abort);
      job.reject(unavailable());
    }
    this.waiting.length = 0;
    this.active = undefined;
    if (worker) void this.terminate(worker).catch(() => undefined);
  }

  private async stop(): Promise<void> {
    this.closed = true;
    for (const job of [...this.waiting, ...(this.active ? [this.active] : [])]) {
      job.signal.removeEventListener('abort', job.abort);
      job.reject(new LocalModelError('SEARCH_MODEL_CLOSED', 'Local model resource is closed'));
    }
    this.waiting.length = 0;
    const worker = this.worker;
    this.worker = undefined;
    if (worker) await this.terminate(worker);
    await this.terminating;
    this.active = undefined;
  }
}
