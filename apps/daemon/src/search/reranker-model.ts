/** The pinned graph contains qint8 weights; fp32 selects its explicit unsuffixed filename. */
export const LOCAL_RERANKER_MODEL = Object.freeze({
  modelId: 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1',
  revision: '1427fd652930e4ba29e8149678df786c240d8825',
  maxInputTokens: 512,
  device: 'cpu',
  dtype: 'fp32',
  modelFileName: 'model_qint8_arm64',
  signature:
    'mmarco-mMiniLMv2-L12-H384-v1:1427fd652930e4ba29e8149678df786c240d8825:cpu:model_qint8_arm64:pair512:sigmoid:v1',
  files: ['config.json', 'tokenizer_config.json', 'tokenizer.json', 'onnx/model_qint8_arm64.onnx'],
});
