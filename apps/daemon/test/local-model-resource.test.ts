import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { LocalSearchModelResource } from '../src/search/local-model-resource';
import { LocalToolSearchEmbedder } from '../src/search/tool-search-embedder';
import { LOCAL_EMBEDDING_MODEL } from '../src/search/embedding-model';
import { LOCAL_RERANKER_MODEL } from '../src/search/reranker-model';

interface Fixture {
  directory: string;
  resource: LocalSearchModelResource;
  audit(): Promise<Audit[]>;
  cached(model?: 'embedding' | 'reranker'): Promise<void>;
  release(): Promise<void>;
}

type Audit = {
  kind: string;
  text?: string;
  remote?: boolean;
  localOnly?: boolean;
  inputs?: number;
  model?: string;
  filename?: string;
  dtype?: string;
};

const AuditSchema = Type.Array(
  Type.Object(
    {
      kind: Type.String(),
      text: Type.Optional(Type.String()),
      remote: Type.Optional(Type.Boolean()),
      localOnly: Type.Optional(Type.Boolean()),
      inputs: Type.Optional(Type.Integer()),
      model: Type.Optional(Type.String()),
      filename: Type.Optional(Type.String()),
      dtype: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
);
const cleanups: (() => Promise<void>)[] = [];
const signal = (): AbortSignal => AbortSignal.timeout(5000);

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const model = `
import { appendFile, writeFile } from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import { join } from 'node:path';
export const env = {};
let directory;
async function log(value) { await appendFile(join(directory, 'audit.jsonl'), JSON.stringify(value) + '\\n'); }
async function gate() {
  const file = join(directory, 'release');
  if (existsSync(file)) return;
  await new Promise(resolve => {
    const watcher = watch(directory, () => { if (existsSync(file)) { watcher.close(); resolve(); } });
    if (existsSync(file)) { watcher.close(); resolve(); }
  });
}
export async function pipeline(task, model, options) {
  directory = options.cache_dir;
  await log({ kind: 'load', model, remote: env.allowRemoteModels, localOnly: options.local_files_only });
  if (existsSync(join(directory, 'hang-load'))) await gate();
  if (options.local_files_only && !existsSync(join(directory, 'available'))) throw new Error('private-loader-token-path');
  if (!options.local_files_only) {
    await writeFile(join(directory, 'available'), 'ok');
    options.progress_callback({ status: 'progress_total', loaded: 25, total: 100 });
  }
  const extractor = async inputs => {
    await log({ kind: 'start', text: inputs[0], inputs: inputs.length });
    if (inputs.some(text => text.includes('[hold]'))) await gate();
    if (inputs.some(text => text.includes('[bad]'))) return { tolist: () => [[1, 2]] };
    const vectors = inputs.map(text => {
      const row = Array(384).fill(0);
      row[text.startsWith('query: ') ? 0 : 1] = 1;
      return row;
    });
    await log({ kind: 'end', text: inputs[0] });
    return { tolist: () => vectors };
  };
  extractor.tokenizer = (texts, options) => {
    if (options.truncation !== false || options.return_tensor !== false || options.padding !== false) throw new Error('Unbounded tokenizer fixture expected');
    return { input_ids: texts.map(text => Array.from({ length: [...text].length + 2 }, (_, index) => index)) };
  };
  extractor.tokenizer.model_max_length = 512;
  return extractor;
}
export const AutoTokenizer = {
  async from_pretrained(model, options) {
    directory = options.cache_dir;
    await log({ kind: 'load-reranker-tokenizer', model, remote: env.allowRemoteModels, localOnly: options.local_files_only });
    if (existsSync(join(directory, 'hang-reranker-load'))) await gate();
    if (options.local_files_only && !existsSync(join(directory, 'reranker-available'))) throw new Error('private-reranker-loader-path');
    if (!options.local_files_only) {
      await writeFile(join(directory, 'reranker-available'), 'ok');
      options.progress_callback({ status: 'progress_total', loaded: 50, total: 200 });
    }
    const tokenizer = (queries, options) => {
      if (options.truncation !== false || options.add_special_tokens !== true) throw new Error('Pair truncation is forbidden');
      if (options.padding === false) {
        if (options.return_tensor !== false) throw new Error('Expected raw pair token counts');
        return { input_ids: queries.map((query, index) => Array([...query].length + [...options.text_pair[index]].length + 3).fill(0)) };
      }
      return { queries, passages: options.text_pair };
    };
    tokenizer.model_max_length = 512;
    return tokenizer;
  }
};
export const AutoModelForSequenceClassification = {
  async from_pretrained(model, options) {
    directory = options.cache_dir;
    await log({ kind: 'load-reranker-model', model, remote: env.allowRemoteModels, localOnly: options.local_files_only, filename: options.model_file_name, dtype: options.dtype });
    return async inputs => {
      await log({ kind: 'start-rerank', text: inputs.passages[0], inputs: inputs.passages.length });
      if (inputs.passages.some(text => text.includes('[hold]'))) await gate();
      if (inputs.passages.some(text => text.includes('[throw]'))) throw new Error('private-native-model-token');
      if (inputs.passages.some(text => text.includes('[bad]'))) return { logits: { tolist: () => [[1, 2]] } };
      await log({ kind: 'end-rerank', text: inputs.passages[0] });
      return { logits: { tolist: () => inputs.passages.map(text => [text.includes('negative') ? -2 : 2]) } };
    };
  }
};
`;

async function fixture(source = model): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'local-embedding-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const module = join(directory, 'model.mjs');
  await writeFile(module, source);
  const resource = new LocalSearchModelResource({
    cacheDirectory: directory,
    moduleUrl: pathToFileURL(module).href,
  });
  cleanups.push(() => resource.close());
  return {
    directory,
    resource,
    async audit() {
      let text: string;
      try {
        text = await readFile(join(directory, 'audit.jsonl'), 'utf8');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
        throw error;
      }
      const result: unknown = text.trim()
        ? text
            .trim()
            .split('\n')
            .map((line): unknown => JSON.parse(line))
        : [];
      if (!Value.Check(AuditSchema, result)) throw new Error('Invalid fixture audit');
      return result;
    },
    async cached(kind = 'embedding') {
      await writeFile(
        join(directory, kind === 'embedding' ? 'available' : 'reranker-available'),
        'ok',
      );
      const spec = kind === 'embedding' ? LOCAL_EMBEDDING_MODEL : LOCAL_RERANKER_MODEL;
      const root = join(directory, spec.modelId, spec.revision);
      await mkdir(join(root, 'onnx'), { recursive: true });
      for (const file of spec.files) await writeFile(join(root, file), 'cached');
    },
    release: () => writeFile(join(directory, 'release'), 'ok'),
  };
}

async function started(f: Fixture, needle: string): Promise<void> {
  await vi.waitFor(async () =>
    expect(
      (await f.audit()).some((entry) => entry.kind === 'start' && entry.text?.includes(needle)),
    ).toBe(true),
  );
}

it('keeps ordinary queries local-only and makes remote preparation explicit', async () => {
  const f = await fixture();
  expect(f.resource.embedding.status().state).toBe('unprepared');
  await expect(
    f.resource.embedding.embed(['account'], {
      kind: 'query',
      priority: 'foreground',
      signal: signal(),
    }),
  ).rejects.toMatchObject({ code: 'SEARCH_MODEL_NOT_PREPARED' });
  expect(await f.audit()).toEqual([
    {
      kind: 'load',
      model: join(f.directory, LOCAL_EMBEDDING_MODEL.modelId, LOCAL_EMBEDDING_MODEL.revision),
      remote: false,
      localOnly: true,
    },
  ]);
  expect(f.resource.embedding.status()).toMatchObject({
    state: 'unprepared',
    error: 'LOCAL_MODEL_UNAVAILABLE',
  });
  await f.resource.embedding.prepare(signal());
  expect(f.resource.embedding.status()).toMatchObject({
    state: 'ready',
    error: null,
    dimensions: 384,
    maxInputTokens: 512,
  });
  expect((await f.audit()).filter(({ kind }) => kind === 'load')).toEqual([
    {
      kind: 'load',
      model: join(f.directory, LOCAL_EMBEDDING_MODEL.modelId, LOCAL_EMBEDDING_MODEL.revision),
      remote: false,
      localOnly: true,
    },
    { kind: 'load', model: LOCAL_EMBEDDING_MODEL.modelId, remote: true, localOnly: false },
  ]);
  const adapter = new LocalToolSearchEmbedder(f.resource.embedding);
  const query = await adapter.embed('query', ['account'], signal());
  const documents = await adapter.embed(
    'document',
    Array.from({ length: 33 }, (_, index) => `description ${index}`),
    signal(),
  );
  expect(query[0]?.slice(0, 2)).toEqual([1, 0]);
  expect(documents).toHaveLength(33);
  expect(documents[0]?.slice(0, 2)).toEqual([0, 1]);
  expect((await f.audit()).filter(({ kind }) => kind === 'load')).toHaveLength(2);
  expect(
    (await f.audit())
      .filter(({ kind, text }) => kind === 'start' && text?.startsWith('passage: '))
      .map(({ inputs }) => inputs),
  ).toEqual([16, 16, 1]);
});

it('counts the prefix and special tokens without silent model truncation', async () => {
  const f = await fixture();
  await f.cached();
  expect(
    await f.resource.embedding.tokenCounts(['中文🪐'], {
      kind: 'query',
      priority: 'foreground',
      signal: signal(),
    }),
  ).toEqual([12]);
  const max = 'x'.repeat(503);
  await expect(
    f.resource.embedding.embed([max], { kind: 'query', priority: 'foreground', signal: signal() }),
  ).resolves.toHaveLength(1);
  await expect(
    f.resource.embedding.embed([max + 'x'], {
      kind: 'query',
      priority: 'foreground',
      signal: signal(),
    }),
  ).rejects.toMatchObject({ code: 'SEARCH_MODEL_TOKEN_LIMIT' });
  expect((await f.audit()).filter(({ kind }) => kind === 'start')).toHaveLength(1);
});

it('removes queued cancellation and retains active capacity until actual native settlement', async () => {
  const f = await fixture();
  await f.cached();
  const controller = new AbortController();
  const active = f.resource.embedding.embed(['[hold]'], {
    kind: 'passage',
    priority: 'background',
    signal: controller.signal,
  });
  await started(f, '[hold]');
  const queued = new AbortController();
  const abandoned = f.resource.embedding.embed(['never dispatched'], {
    kind: 'query',
    priority: 'foreground',
    signal: queued.signal,
  });
  const queuedRejected = expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });
  queued.abort();
  await queuedRejected;
  const activeRejected = expect(active).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await activeRejected;
  const next = f.resource.embedding.embed(['next request'], {
    kind: 'query',
    priority: 'foreground',
    signal: signal(),
  });
  expect((await f.audit()).filter(({ kind }) => kind === 'start')).toHaveLength(1);
  await f.release();
  await expect(next).resolves.toHaveLength(1);
  const order = (await f.audit())
    .filter(({ kind }) => kind === 'start' || kind === 'end')
    .map(({ kind, text }) => `${kind}:${text}`);
  expect(order).toEqual([
    'start:passage: [hold]',
    'end:passage: [hold]',
    'start:query: next request',
    'end:query: next request',
  ]);
});

it('selects priority in the host and gives background batches bounded opportunities', async () => {
  const f = await fixture();
  await f.cached();
  const hold = f.resource.embedding.embed(['[hold]'], {
    kind: 'passage',
    priority: 'background',
    signal: signal(),
  });
  await started(f, '[hold]');
  const background = f.resource.embedding.embed(['background queued'], {
    kind: 'passage',
    priority: 'background',
    signal: signal(),
  });
  const tool = Array.from({ length: 5 }, (_, index) =>
    f.resource.embedding.embed([`tool ${index}`], {
      kind: 'query',
      priority: 'tool',
      signal: signal(),
    }),
  );
  const foreground = Array.from({ length: 40 }, (_, index) =>
    f.resource.embedding.embed([`foreground ${index}`], {
      kind: 'query',
      priority: 'foreground',
      signal: signal(),
    }),
  );
  await f.release();
  await Promise.all([hold, background, ...tool, ...foreground]);
  const order = (await f.audit()).filter(({ kind }) => kind === 'start').map(({ text }) => text);
  expect(order[1]).toBe('query: foreground 0');
  expect(order.indexOf('query: tool 0')).toBeLessThanOrEqual(9);
  expect(order.indexOf('passage: background queued')).toBeLessThanOrEqual(37);
});

it('shares preparation and cancels a loading Worker before reporting completion', async () => {
  const f = await fixture();
  await writeFile(join(f.directory, 'hang-load'), 'hold');
  const controller = new AbortController();
  const preparing = f.resource.embedding.prepare(controller.signal);
  expect(f.resource.embedding.prepare(signal())).toBe(preparing);
  const rejected = expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(async () =>
    expect((await f.audit()).some(({ kind }) => kind === 'load')).toBe(true),
  );
  expect(f.resource.embedding.status().state).toBe('preparing');
  await expect(
    new LocalToolSearchEmbedder(f.resource.embedding).embed(
      'query',
      ['tool during preparation'],
      signal(),
    ),
  ).rejects.toMatchObject({ code: 'SEARCH_MODEL_NOT_PREPARED' });
  controller.abort();
  await rejected;
  expect(f.resource.embedding.status().state).toBe('unprepared');
  await f.release();
  await f.cached();
  await expect(
    f.resource.embedding.embed(['after cancelled preparation'], {
      kind: 'query',
      priority: 'foreground',
      signal: signal(),
    }),
  ).resolves.toHaveLength(1);
  expect((await f.audit()).filter(({ kind }) => kind === 'load')).toHaveLength(2);
});

it('reads a pre-existing fixed local cache and exposes no arbitrary model parameters', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'embedding-cache-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, LOCAL_EMBEDDING_MODEL.modelId, LOCAL_EMBEDDING_MODEL.revision);
  await mkdir(join(root, 'onnx'), { recursive: true });
  for (const file of [
    'config.json',
    'tokenizer_config.json',
    'tokenizer.json',
    'onnx/model_quantized.onnx',
  ])
    await writeFile(join(root, file), 'cached');
  const resource = new LocalSearchModelResource({ cacheDirectory: directory });
  cleanups.push(() => resource.close());
  expect(resource.embedding.status().state).toBe('ready');
});

it('closes pending inference and terminates its owned Worker before refusing new jobs', async () => {
  const f = await fixture();
  await f.cached();
  const pending = f.resource.embedding.embed(['[hold]'], {
    kind: 'query',
    priority: 'foreground',
    signal: signal(),
  });
  await started(f, '[hold]');
  const rejected = expect(pending).rejects.toMatchObject({ code: 'SEARCH_MODEL_CLOSED' });
  await f.resource.close();
  await rejected;
  await f.resource.close();
  await expect(
    f.resource.embedding.embed(['late'], {
      kind: 'query',
      priority: 'foreground',
      signal: signal(),
    }),
  ).rejects.toMatchObject({ code: 'SEARCH_MODEL_CLOSED' });
});

it('rejects malformed vectors without leaking model loader messages', async () => {
  const f = await fixture();
  await f.cached();
  await expect(
    f.resource.embedding.embed(['[bad]'], {
      kind: 'query',
      priority: 'foreground',
      signal: signal(),
    }),
  ).rejects.toThrow('Local model resource is unavailable');
  expect(f.resource.embedding.status()).toMatchObject({
    state: 'unavailable',
    error: 'LOCAL_MODEL_UNAVAILABLE',
  });
  await expect(
    f.resource.embedding.embed(['recovered after worker failure'], {
      kind: 'query',
      priority: 'foreground',
      signal: signal(),
    }),
  ).resolves.toHaveLength(1);
  const broken = await fixture(
    'export const env = {}; export function pipeline() { throw new Error("private-loader-token-path"); }',
  );
  await expect(broken.resource.embedding.prepare(signal())).rejects.toThrow(
    'Local model must be prepared',
  );
  expect(broken.resource.embedding.status()).toMatchObject({
    state: 'unavailable',
    error: 'PREPARE_FAILED',
  });
});

it('prepares only the selected model and keeps separate readiness with an unchanged vector signature', async () => {
  const f = await fixture();
  await f.cached();
  await f.resource.embedding.embed(['warm embedding'], {
    kind: 'query',
    priority: 'foreground',
    signal: signal(),
  });
  expect(f.resource.reranker.status()).toMatchObject({
    state: 'unprepared',
    modelId: LOCAL_RERANKER_MODEL.modelId,
  });
  expect(f.resource.reranker.status()).not.toHaveProperty('dimensions');
  await expect(
    f.resource.reranker.rerank('account', ['positive'], {
      priority: 'foreground',
      signal: signal(),
    }),
  ).rejects.toMatchObject({ code: 'SEARCH_MODEL_NOT_PREPARED' });
  expect(f.resource.embedding.status().state).toBe('ready');
  const preparing = f.resource.reranker.prepare(signal());
  expect(f.resource.reranker.prepare(signal())).toBe(preparing);
  await preparing;
  expect(f.resource.reranker.status()).toMatchObject({
    state: 'ready',
    error: null,
    maxInputTokens: 512,
  });
  expect(f.resource.embedding.status().signature).toBe(LOCAL_EMBEDDING_MODEL.signature);
  const scores = await f.resource.reranker.rerank('account', ['positive', 'negative'], {
    priority: 'foreground',
    signal: signal(),
  });
  expect(scores[0]).toBeCloseTo(0.880797);
  expect(scores[1]).toBeCloseTo(0.119203);
  const loaders = (await f.audit()).filter(({ kind }) => kind.startsWith('load'));
  expect(loaders.filter(({ kind }) => kind === 'load')).toHaveLength(1);
  expect(loaders.filter(({ remote }) => remote === true)).toEqual([
    {
      kind: 'load-reranker-tokenizer',
      model: LOCAL_RERANKER_MODEL.modelId,
      remote: true,
      localOnly: false,
    },
    {
      kind: 'load-reranker-model',
      model: LOCAL_RERANKER_MODEL.modelId,
      remote: true,
      localOnly: false,
      filename: 'model_qint8_arm64',
      dtype: 'fp32',
    },
  ]);
});

it('scores legal full pairs in order and leaves only oversized pairs unverified', async () => {
  const f = await fixture();
  await f.cached('reranker');
  const scores = await f.resource.reranker.rerank(
    'q',
    ['x'.repeat(508), 'x'.repeat(509), 'negative'],
    {
      priority: 'foreground',
      signal: signal(),
    },
  );
  expect(scores).toHaveLength(3);
  expect(scores[0]).toBeCloseTo(0.880797);
  expect(scores[1]).toBeNull();
  expect(scores[2]).toBeCloseTo(0.119203);
  expect((await f.audit()).find(({ kind }) => kind === 'start-rerank')?.inputs).toBe(2);
  await expect(
    f.resource.reranker.rerank('x'.repeat(510), ['a', 'b'], {
      priority: 'foreground',
      signal: signal(),
    }),
  ).resolves.toEqual([null, null]);
  expect((await f.audit()).filter(({ kind }) => kind === 'start-rerank')).toHaveLength(1);
  expect(f.resource.reranker.status()).toMatchObject({ state: 'ready', error: null });
  expect(
    (await f.audit())
      .filter(({ kind }) => kind.startsWith('load'))
      .every(({ remote, localOnly }) => remote === false && localOnly === true),
  ).toBe(true);
});

it('retains one native slot after rerank cancellation and removes an abandoned cross-model waiter', async () => {
  const f = await fixture();
  await f.cached();
  await f.cached('reranker');
  const controller = new AbortController();
  const active = f.resource.reranker.rerank('q', ['[hold]'], {
    priority: 'foreground',
    signal: controller.signal,
  });
  await vi.waitFor(async () =>
    expect((await f.audit()).some(({ kind }) => kind === 'start-rerank')).toBe(true),
  );
  const queued = new AbortController();
  const abandoned = f.resource.embedding.embed(['abandoned'], {
    kind: 'query',
    priority: 'foreground',
    signal: queued.signal,
  });
  const abandonedRejected = expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });
  queued.abort();
  await abandonedRejected;
  const activeRejected = expect(active).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await activeRejected;
  const next = f.resource.embedding.embed(['after rerank'], {
    kind: 'query',
    priority: 'foreground',
    signal: signal(),
  });
  expect((await f.audit()).some(({ kind }) => kind === 'start')).toBe(false);
  await f.release();
  await expect(next).resolves.toHaveLength(1);
  expect(
    (await f.audit())
      .filter(({ kind }) => kind.startsWith('start') || kind.startsWith('end'))
      .map(({ kind }) => kind),
  ).toEqual(['start-rerank', 'end-rerank', 'start', 'end']);
});

it('reenters the shared fair queue between four-pair rerank batches', async () => {
  const f = await fixture();
  await f.cached();
  await f.cached('reranker');
  const hold = f.resource.embedding.embed(['[hold]'], {
    kind: 'passage',
    priority: 'background',
    signal: signal(),
  });
  await started(f, '[hold]');
  const background = f.resource.embedding.embed(['background after first rerank batch'], {
    kind: 'passage',
    priority: 'background',
    signal: signal(),
  });
  const rerank = f.resource.reranker.rerank(
    'q',
    Array.from({ length: 20 }, (_, index) => `positive ${index}`),
    { priority: 'foreground', signal: signal() },
  );
  await f.release();
  await Promise.all([hold, background, rerank]);
  const starts = (await f.audit()).filter(({ kind }) => kind.startsWith('start'));
  expect(starts.filter(({ kind }) => kind === 'start-rerank').map(({ inputs }) => inputs)).toEqual([
    4, 4, 4, 4, 4,
  ]);
  expect(starts[1]?.kind).toBe('start-rerank');
  expect(starts.findIndex(({ text }) => text?.includes('background after'))).toBeLessThan(6);
});

it('declines foreground work during preparation and reloads both model sessions after cancelling it', async () => {
  const f = await fixture();
  await f.cached();
  await f.resource.embedding.embed(['warm'], {
    kind: 'query',
    priority: 'foreground',
    signal: signal(),
  });
  await writeFile(join(f.directory, 'hang-reranker-load'), 'hold');
  const controller = new AbortController();
  const preparing = f.resource.reranker.prepare(controller.signal);
  await vi.waitFor(async () =>
    expect((await f.audit()).some(({ kind }) => kind === 'load-reranker-tokenizer')).toBe(true),
  );
  expect(f.resource.embedding.status().state).toBe('ready');
  expect(f.resource.reranker.status().state).toBe('preparing');
  await expect(
    f.resource.embedding.embed(['foreground'], {
      kind: 'query',
      priority: 'foreground',
      signal: signal(),
    }),
  ).rejects.toMatchObject({ code: 'SEARCH_MODEL_BUSY' });
  await expect(
    new LocalToolSearchEmbedder(f.resource.embedding).embed('query', ['tool'], signal()),
  ).rejects.toMatchObject({ code: 'SEARCH_MODEL_BUSY' });
  await expect(
    f.resource.reranker.rerank('q', ['candidate'], { priority: 'foreground', signal: signal() }),
  ).rejects.toMatchObject({ code: 'SEARCH_MODEL_BUSY' });
  const queuedController = new AbortController();
  const queuedPreparation = f.resource.embedding.prepare(queuedController.signal);
  const queuedRejected = expect(queuedPreparation).rejects.toMatchObject({ name: 'AbortError' });
  queuedController.abort();
  await queuedRejected;
  const background = f.resource.embedding.embed(['after prepare cancellation'], {
    kind: 'passage',
    priority: 'background',
    signal: signal(),
  });
  const rejected = expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  expect(f.resource.embedding.status().state).toBe('ready');
  expect(f.resource.reranker.status().state).toBe('unprepared');
  await expect(background).resolves.toHaveLength(1);
  expect((await f.audit()).filter(({ kind }) => kind === 'load')).toHaveLength(2);
  await f.release();
  await f.resource.reranker.prepare(signal());
  await expect(
    f.resource.reranker.rerank('q', ['after restart'], {
      priority: 'foreground',
      signal: signal(),
    }),
  ).resolves.toHaveLength(1);
  expect((await f.audit()).filter(({ kind }) => kind === 'load-reranker-tokenizer')).toHaveLength(
    2,
  );
});

it('restores model readiness when preparation cannot enter a full queue', async () => {
  const f = await fixture();
  await f.cached();
  await f.cached('reranker');
  const active = f.resource.reranker.rerank('q', ['[hold]'], {
    priority: 'foreground',
    signal: signal(),
  });
  await vi.waitFor(async () =>
    expect((await f.audit()).some(({ kind }) => kind === 'start-rerank')).toBe(true),
  );
  const controller = new AbortController();
  const waiting = Array.from({ length: 64 }, (_, index) =>
    f.resource.embedding.embed([`queued ${index}`], {
      kind: 'passage',
      priority: 'background',
      signal: controller.signal,
    }),
  );
  const settled = Promise.allSettled(waiting);
  await expect(f.resource.embedding.prepare(signal())).rejects.toMatchObject({
    code: 'SEARCH_MODEL_QUEUE_FULL',
  });
  expect(f.resource.embedding.status().state).toBe('ready');
  controller.abort();
  expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
  await f.release();
  await active;
});

it('clears both resident sessions after a Worker failure and reopens them only from local caches', async () => {
  const f = await fixture();
  await f.cached();
  await f.cached('reranker');
  await f.resource.reranker.rerank('q', ['warm reranker'], {
    priority: 'foreground',
    signal: signal(),
  });
  await expect(
    f.resource.embedding.embed(['[bad]'], {
      kind: 'query',
      priority: 'foreground',
      signal: signal(),
    }),
  ).rejects.toMatchObject({ code: 'SEARCH_MODEL_UNAVAILABLE' });
  expect(f.resource.embedding.status().state).toBe('unavailable');
  expect(f.resource.reranker.status().state).toBe('unavailable');
  await f.resource.reranker.rerank('q', ['reopened reranker'], {
    priority: 'foreground',
    signal: signal(),
  });
  await f.resource.embedding.embed(['reopened embedding'], {
    kind: 'query',
    priority: 'foreground',
    signal: signal(),
  });
  expect(f.resource.embedding.status().state).toBe('ready');
  expect(f.resource.reranker.status().state).toBe('ready');
  const loaders = (await f.audit()).filter(({ kind }) => kind.startsWith('load'));
  expect(loaders.filter(({ kind }) => kind === 'load')).toHaveLength(2);
  expect(loaders.filter(({ kind }) => kind === 'load-reranker-model')).toHaveLength(2);
  expect(loaders.every(({ remote, localOnly }) => remote === false && localOnly === true)).toBe(
    true,
  );
});

it('keeps model errors sanitized and closes both views with active reranking', async () => {
  const f = await fixture();
  await f.cached('reranker');
  await expect(
    f.resource.reranker.rerank('q', ['[bad]'], { priority: 'foreground', signal: signal() }),
  ).rejects.toThrow('Local model must be prepared');
  await expect(
    f.resource.reranker.rerank('q', ['[throw]'], { priority: 'foreground', signal: signal() }),
  ).rejects.toMatchObject({ code: 'SEARCH_MODEL_UNAVAILABLE' });
  const pending = f.resource.reranker.rerank('q', ['[hold]'], {
    priority: 'foreground',
    signal: signal(),
  });
  await vi.waitFor(async () =>
    expect((await f.audit()).filter(({ kind }) => kind === 'start-rerank')).toHaveLength(3),
  );
  const rejected = expect(pending).rejects.toMatchObject({ code: 'SEARCH_MODEL_CLOSED' });
  await f.resource.close();
  await rejected;
  await expect(
    f.resource.reranker.rerank('q', ['late'], { priority: 'foreground', signal: signal() }),
  ).rejects.toMatchObject({ code: 'SEARCH_MODEL_CLOSED' });
  await expect(
    f.resource.embedding.embed(['late'], {
      kind: 'query',
      priority: 'foreground',
      signal: signal(),
    }),
  ).rejects.toMatchObject({ code: 'SEARCH_MODEL_CLOSED' });
});
