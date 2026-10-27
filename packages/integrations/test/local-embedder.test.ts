import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { LocalToolSearchEmbedder } from '../src/search/local-embedder.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture(source: string) {
  const directory = await mkdtemp(join(tmpdir(), 'tool-embedding-'));
  cleanups.push(async () => await rm(directory, { recursive: true, force: true }));
  const module = join(directory, 'model.mjs');
  await writeFile(module, source);
  const embedder = new LocalToolSearchEmbedder({
    cacheDirectory: directory,
    moduleUrl: pathToFileURL(module).href,
  });
  cleanups.push(async () => await embedder.close());
  return embedder;
}
const model = `
let loads = 0;
export async function pipeline() {
  loads += 1;
  return async inputs => ({ tolist: () => inputs.map(text => {
    const row = Array(384).fill(0);
    row[0] = text.startsWith('query: ') ? 1 : 0;
    row[1] = loads;
    row[2] = inputs.length;
    return row;
  }) });
}
`;

it('uses the owned worker, E5 prefixes and bounded batches while retaining loaded weights', async () => {
  const embedder = await fixture(model);
  const query = await embedder.embed('query', ['account'], AbortSignal.timeout(5000));
  expect(query[0]?.slice(0, 3)).toEqual([1, 1, 1]);
  const documents = await embedder.embed(
    'document',
    Array.from({ length: 33 }, (_, index) => `description ${index}`),
    AbortSignal.timeout(5000),
  );
  expect(documents).toHaveLength(33);
  expect(documents[0]?.slice(0, 3)).toEqual([0, 1, 32]);
  expect(documents[32]?.slice(0, 3)).toEqual([0, 1, 1]);
});

it('removes an aborted caller without preventing another caller from using the worker', async () => {
  const embedder = await fixture(model);
  const controller = new AbortController();
  const cancelled = embedder.embed('query', ['cancel'], controller.signal);
  const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(new Error('private-abort-details'));
  await rejected;
  await expect(embedder.embed('query', ['next'], AbortSignal.timeout(5000))).resolves.toHaveLength(
    1,
  );
});

it('closes pending model work and refuses further inference', async () => {
  const embedder = await fixture('export function pipeline() { return new Promise(() => {}); }');
  const running = embedder.embed('query', ['pending'], new AbortController().signal);
  const rejected = expect(running).rejects.toThrow('Local tool search embedding unavailable');
  await embedder.close();
  await rejected;
  await embedder.close();
  await expect(embedder.embed('query', ['late'], new AbortController().signal)).rejects.toThrow(
    'Tool search embedding is closed',
  );
});

it('does not expose model loader messages or malformed vectors', async () => {
  for (const source of [
    'export function pipeline() { throw new Error("private-loader-path-or-token"); }',
    'export async function pipeline() { return async () => ({ tolist: () => [[1, 2]] }); }',
  ]) {
    const embedder = await fixture(source);
    await expect(embedder.embed('query', ['test'], AbortSignal.timeout(5000))).rejects.toThrow(
      'Local tool search embedding unavailable',
    );
  }
});
