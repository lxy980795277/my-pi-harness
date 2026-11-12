/** The resource identity includes every choice that can change indexed vectors. */
export const LOCAL_EMBEDDING_MODEL = Object.freeze({
  modelId: 'Xenova/multilingual-e5-small',
  revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  dimensions: 384,
  maxInputTokens: 512,
  device: 'cpu',
  dtype: 'q8',
  signature:
    'e5-small:761b726dd34fb83930e26aab4e9ac3899aa1fa78:cpu:q8:mean:normalized:query-passage:512:v1',
  files: ['config.json', 'tokenizer_config.json', 'tokenizer.json', 'onnx/model_quantized.onnx'],
});
