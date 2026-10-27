import { Worker } from 'node:worker_threads';
import { isAbsolute } from 'node:path';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { LOCAL_EMBEDDING_WORKER } from './local-embedding-worker.js';

interface Request {
  count: number;
  signal: AbortSignal;
  abort: () => void;
  resolve(value: readonly (readonly number[])[]): void;
  reject(error: Error): void;
}

export interface LocalToolSearchEmbedderOptions {
  cacheDirectory: string;
  /** Explicit host test injection; never populated from a tool, manifest or environment. */
  moduleUrl?: string;
}

const MODEL = 'Xenova/multilingual-e5-small';
const REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';

const ReplySchema = Type.Union([
  Type.Object({ id: Type.Integer(), error: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object(
    {
      id: Type.Integer(),
      vectors: Type.Array(Type.Array(Type.Number(), { minItems: 384, maxItems: 384 }), {
        maxItems: 32,
      }),
    },
    { additionalProperties: false },
  ),
]);

/** Lazy CPU embeddings run outside the daemon loop; shutdown terminates owned model work. */
export class LocalToolSearchEmbedder {
  private worker: Worker | undefined;
  private readonly pending = new Map<number, Request>();
  private serial = 0;
  private closed = false;
  private closing: Promise<void> | undefined;
  public constructor(private readonly options: LocalToolSearchEmbedderOptions) {
    if (!isAbsolute(options.cacheDirectory))
      throw new Error('Tool search model cache must be absolute');
  }

  private start(): Worker {
    if (this.closed) throw new Error('Tool search embedding is closed');
    if (this.worker !== undefined) return this.worker;
    const worker = new Worker(LOCAL_EMBEDDING_WORKER, {
      eval: true,
      execArgv: [],
      workerData: {
        model: MODEL,
        revision: REVISION,
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
    worker.on('message', (message: unknown) => {
      if (!Value.Check(ReplySchema, message)) {
        this.fail();
        return;
      }
      const request = this.pending.get(message.id);
      if (request === undefined) return;
      this.pending.delete(message.id);
      request.signal.removeEventListener('abort', request.abort);
      if ('error' in message || message.vectors.length !== request.count) {
        request.reject(new Error('Local tool search embedding unavailable'));
        return;
      }
      request.resolve(message.vectors);
    });
    worker.on('error', () => this.fail());
    worker.on('exit', () => {
      if (this.worker === worker) this.worker = undefined;
      this.fail();
    });
    this.worker = worker;
    return worker;
  }
  private fail(): void {
    for (const request of this.pending.values()) {
      request.signal.removeEventListener('abort', request.abort);
      request.reject(new Error('Local tool search embedding unavailable'));
    }
    this.pending.clear();
  }
  private async batch(
    purpose: 'document' | 'query',
    inputs: readonly string[],
    signal: AbortSignal,
  ): Promise<readonly (readonly number[])[]> {
    signal.throwIfAborted();
    if (this.pending.size >= 64) throw new Error('Tool search embedding queue is full');
    const worker = this.start();
    const id = ++this.serial;
    return await new Promise((resolve, reject) => {
      const abort = (): void => {
        if (!this.pending.delete(id)) return;
        signal.removeEventListener('abort', abort);
        worker.postMessage({ id, cancel: true });
        reject(new DOMException('Tool search embedding cancelled', 'AbortError'));
      };
      this.pending.set(id, { count: inputs.length, signal, abort, resolve, reject });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      worker.postMessage({ id, purpose, inputs });
    });
  }

  /** Embed bounded text batches; cancelling a caller removes its queued inference, not shared weights. */
  public async embed(
    purpose: 'document' | 'query',
    inputs: readonly string[],
    signal: AbortSignal,
  ): Promise<readonly (readonly number[])[]> {
    signal.throwIfAborted();
    if (this.closed) throw new Error('Tool search embedding is closed');
    if (inputs.length > 512 || inputs.some((text) => text.length > 16_000))
      throw new Error('Tool search embedding input limit exceeded');
    const vectors: (readonly number[])[] = [];
    for (let offset = 0; offset < inputs.length; offset += 32)
      vectors.push(...(await this.batch(purpose, inputs.slice(offset, offset + 32), signal)));
    return vectors;
  }

  public close(): Promise<void> {
    this.closing ??= this.stop();
    return this.closing;
  }
  private async stop(): Promise<void> {
    this.closed = true;
    this.fail();
    const worker = this.worker;
    this.worker = undefined;
    if (worker !== undefined) await worker.terminate();
  }
}
