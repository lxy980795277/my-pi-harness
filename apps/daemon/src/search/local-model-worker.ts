/** One Worker hosts both fixed models; only the host schedules active operations. */
export const LOCAL_MODEL_WORKER = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { join } = require('node:path');
let active;
let extractor;
let tokenizer;
let classifier;
let modulePromise;
function resident(model) { return model === 'embedding' ? Boolean(extractor) : Boolean(tokenizer && classifier); }
async function load(remote, job) {
  const module = await (modulePromise ??= import(workerData.moduleUrl));
  module.env.allowRemoteModels = remote;
  module.env.allowLocalModels = true;
  module.env.useFSCache = true;
  module.env.useBrowserCache = false;
  const spec = workerData.models[job.model];
  const name = remote ? spec.modelId : join(workerData.cacheDirectory, spec.modelId, spec.revision);
  const options = {
    revision: spec.revision, cache_dir: workerData.cacheDirectory,
    local_files_only: !remote, device: spec.device, dtype: spec.dtype,
    progress_callback: info => {
      if (info.status !== 'progress_total' || !active || active.cancelled) return;
      const loadedBytes = Math.max(0, Math.floor(info.loaded || 0));
      const totalBytes = Number.isFinite(info.total) && info.total > 0 ? Math.floor(info.total) : null;
      parentPort.postMessage({ type: 'progress', id: job.id, loadedBytes, totalBytes });
    }
  };
  if (job.model === 'embedding') {
    extractor ??= await module.pipeline('feature-extraction', name, options);
    if (!Number.isFinite(extractor.tokenizer.model_max_length) || extractor.tokenizer.model_max_length < spec.maxInputTokens)
      throw new Error('Tokenizer length does not support the fixed embedding signature');
  } else {
    tokenizer ??= await module.AutoTokenizer.from_pretrained(name, options);
    classifier ??= await module.AutoModelForSequenceClassification.from_pretrained(name, { ...options, model_file_name: spec.modelFileName });
    if (!Number.isFinite(tokenizer.model_max_length) || tokenizer.model_max_length < spec.maxInputTokens)
      throw new Error('Tokenizer length does not support the fixed reranker signature');
  }
}
async function run(job) {
  active = { id: job.id, cancelled: false };
  let reply;
  try {
    try { await load(job.operation === 'prepare', job); }
    catch {
      if (job.model === 'embedding') extractor = undefined;
      else { tokenizer = undefined; classifier = undefined; }
      reply = { status: 'error', error: job.operation === 'prepare' ? 'UNAVAILABLE' : 'UNPREPARED' };
      return;
    }
    if (active.cancelled) return;
    if (job.operation === 'prepare') { reply = { status: 'prepared' }; return; }
    if (job.model === 'reranker') {
      const queries = job.inputs.map(() => job.query);
      const raw = tokenizer(queries, { text_pair: job.inputs, add_special_tokens: true, padding: false, truncation: false, return_tensor: false });
      const legal = raw.input_ids.flatMap((row, index) => row.length <= workerData.models.reranker.maxInputTokens ? [index] : []);
      const scores = job.inputs.map(() => null);
      if (legal.length === 0) { reply = { status: 'scores', scores }; return; }
      const inputs = tokenizer(legal.map(() => job.query), { text_pair: legal.map(index => job.inputs[index]), add_special_tokens: true, padding: true, truncation: false });
      const output = await classifier(inputs);
      const logits = output.logits.tolist();
      if (logits.length !== legal.length || logits.some(row => !Array.isArray(row) || row.length !== 1 || !Number.isFinite(row[0])))
        throw new Error('Expected one finite relevance logit for each pair');
      for (const [position, [value]] of logits.entries()) scores[legal[position]] = value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
      reply = { status: 'scores', scores };
      return;
    }
    const prefix = job.kind === 'query' ? 'query: ' : 'passage: ';
    const texts = job.inputs.map(text => prefix + text);
    const tokenized = extractor.tokenizer(texts, {
      add_special_tokens: true, padding: false, truncation: false, return_tensor: false
    });
    const counts = tokenized.input_ids.map(row => row.length);
    if (job.operation === 'tokens') { reply = { status: 'tokens', counts }; return; }
    if (counts.some(count => count > workerData.models.embedding.maxInputTokens)) {
      reply = { status: 'error', error: 'TOKEN_LIMIT' }; return;
    }
    const result = await extractor(texts, { pooling: 'mean', normalize: true });
    reply = { status: 'vectors', vectors: result.tolist() };
  } catch {
    reply = { status: 'error', error: 'UNAVAILABLE' };
  } finally {
    const cancelled = active.cancelled;
    active = undefined;
    parentPort.postMessage({ type: 'settled', id: job.id, ready: resident(job.model), ...(cancelled ? { status: 'cancelled' } : reply || { status: 'error', error: 'UNAVAILABLE' }) });
  }
}
parentPort.on('message', message => {
  if (message.type === 'cancel') {
    if (active?.id === message.id) active.cancelled = true;
    return;
  }
  if (active) throw new Error('Local model worker received overlapping operations');
  run(message).catch(() => { throw new Error('Local model worker settlement failed'); });
});
`;
