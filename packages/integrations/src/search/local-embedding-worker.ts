/** Fixed worker program; callers submit text, never JavaScript or model paths. */
export const LOCAL_EMBEDDING_WORKER = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const waiting = new Map();
let active;
let extractor;
async function load() {
  if (!extractor) {
    extractor = import(workerData.moduleUrl).then(({ pipeline }) => pipeline(
      'feature-extraction', workerData.model, {
        revision: workerData.revision, cache_dir: workerData.cacheDirectory,
        device: 'cpu', dtype: 'q8'
      }
    )).catch(() => { extractor = undefined; throw new Error('Model unavailable'); });
  }
  return extractor;
}
async function drain() {
  if (active) return;
  while (waiting.size) {
    const [id, job] = waiting.entries().next().value;
    waiting.delete(id);
    active = { id, cancelled: false };
    try {
      const model = await load();
      if (active.cancelled) continue;
      const prefix = job.purpose === 'query' ? 'query: ' : 'passage: ';
      const result = await model(job.inputs.map(text => prefix + text), {
        pooling: 'mean', normalize: true
      });
      if (!active.cancelled) parentPort.postMessage({ id, vectors: result.tolist() });
    } catch {
      if (!active.cancelled) parentPort.postMessage({ id, error: true });
    } finally {
      active = undefined;
    }
  }
}
parentPort.on('message', message => {
  if (message.cancel) {
    waiting.delete(message.id);
    if (active?.id === message.id) active.cancelled = true;
    return;
  }
  waiting.set(message.id, message);
  drain().catch(() => parentPort.postMessage({ id: message.id, error: true }));
});
`;
