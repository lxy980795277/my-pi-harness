import type { SearchIndexStatus, SearchModelStatus } from '@my-pi-harness/protocol';
import type {
  SearchIndexView,
  SearchLocalModelStatus,
  SearchModelKind,
  SearchModelView,
  SearchResourceTone,
} from '@/features/search/types/resources';

const BYTE_FORMAT = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const COUNT_FORMAT = new Intl.NumberFormat('zh-CN');
const MODEL_LABELS: Record<SearchModelStatus['state'], string> = {
  unprepared: '未准备',
  preparing: '准备中',
  ready: '就绪',
  unavailable: '不可用',
};
const MODEL_TONES: Record<SearchModelStatus['state'], SearchResourceTone> = {
  unprepared: 'secondary',
  preparing: 'warning',
  ready: 'success',
  unavailable: 'error',
};
const MODEL_DESCRIPTIONS: Record<SearchModelKind, Record<SearchModelStatus['state'], string>> = {
  embedding: {
    unprepared: '准备时会下载缺失的模型资源。关键词检索无需准备模型。',
    preparing: '正在准备本地语义模型，可以继续使用工作台。',
    ready: '模型已在本地就绪；语义检索的覆盖范围取决于索引进度。',
    unavailable: '关键词检索仍可使用。',
  },
  reranker: {
    unprepared: '相关记忆自动采用前需要本地复核。固定记忆与人工搜索仍可使用。',
    preparing: '正在准备本地相关性复核模型，可以继续使用工作台。',
    ready: '相关记忆会在本地复核后按额度采用；复核不会将正文发送到远端。',
    unavailable: '相关记忆暂停自动采用。固定记忆与人工搜索仍可使用。',
  },
};
const MODEL_ERRORS: Record<NonNullable<SearchModelStatus['error']>, string> = {
  PREPARE_FAILED: '模型准备失败，请检查网络后重试。',
  LOCAL_MODEL_UNAVAILABLE: '本地模型暂不可用，请重新准备。',
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1_000_000) return `${BYTE_FORMAT.format(bytes / 1000)} KB`;
  return `${BYTE_FORMAT.format(bytes / 1_000_000)} MB`;
};

/** Download progress reports actual bytes and never fabricates a percentage or total. */
export const searchModelView = (
  status: SearchLocalModelStatus,
  kind: SearchModelKind = 'embedding',
): SearchModelView => {
  const description = MODEL_DESCRIPTIONS[kind][status.state];
  let progressLabel: string | null = null;
  if (status.state === 'preparing') {
    if (status.progress !== null) {
      progressLabel = `已下载 ${formatBytes(status.progress.loadedBytes)}`;
      if (status.progress.totalBytes !== null && status.progress.totalBytes > 0) {
        progressLabel += ` / ${formatBytes(status.progress.totalBytes)}`;
      }
    }
  }
  let error: string | null = null;
  if (status.error !== null) error = MODEL_ERRORS[status.error];
  let prepareLabel = '准备模型';
  if (status.state === 'unavailable') prepareLabel = '重新准备';
  return {
    label: MODEL_LABELS[status.state],
    tone: MODEL_TONES[status.state],
    description,
    progressLabel,
    error,
    canPrepare: status.state === 'unprepared' || status.state === 'unavailable',
    prepareLabel,
    canCancel: status.state === 'preparing',
  };
};

/** Text readiness and semantic coverage remain independent of model availability. */
export const searchIndexView = (status: SearchIndexStatus): SearchIndexView => {
  let label = '就绪';
  let tone: SearchResourceTone = 'success';
  if (status.state === 'catching-up') {
    label = '更新中';
    tone = 'warning';
  } else if (status.state === 'failed') {
    label = '更新失败';
    tone = 'error';
  }
  const rebuilding = status.buildingGeneration !== null;
  if (rebuilding) label = '重建中';
  let lexicalLabel = '关键词索引尚未就绪';
  if (status.lexicalReady) lexicalLabel = '关键词检索可用';
  let pendingLabel: string | null = null;
  if (status.pendingSources > 0)
    pendingLabel = `${COUNT_FORMAT.format(status.pendingSources)} 个来源待更新`;
  return {
    label,
    tone,
    lexicalLabel,
    pendingLabel,
    rebuilding,
    coverageLabel: `语义索引 ${COUNT_FORMAT.format(status.vectorCount)} / ${COUNT_FORMAT.format(status.chunkCount)} 个片段`,
  };
};

/** Foreground settings also discover operations started in another window; closing stops polling. */
export const searchModelPollInterval = (
  status: SearchLocalModelStatus | undefined,
): number | false => {
  if (status === undefined) return false;
  if (status.state === 'preparing') return 1000;
  return 10_000;
};

/** An index can keep catching up after a model operation has already settled. */
export const searchIndexPollInterval = (status: SearchIndexStatus | undefined): number | false => {
  if (status === undefined) return false;
  if (status.state === 'catching-up' || status.buildingGeneration !== null) return 1500;
  return 10_000;
};
