export interface SearchPerformanceSource {
  id: string;
  identifier: string;
  kind: 'message' | 'memory';
  workspaceId: string | null;
  text: string;
}

export const SEARCH_PERFORMANCE_WORKSPACES = ['performance-alpha', 'performance-beta'] as const;
export const SEARCH_PERFORMANCE_MESSAGE_COUNT = 1000;
export const SEARCH_PERFORMANCE_MEMORY_COUNT = 400;

const TOPICS = [
  'Database transactions preserve atomic writes and durable commit records across process restarts.',
  'Request scheduling separates foreground latency from background batch work and releases actual resources.',
  'Search indexes retain exact source ranges, lexical terms, normalized vectors and independent generations.',
  'Browser rendering measures visible content and preserves stable scroll anchors during incremental output.',
  'OAuth clients validate callback state, rotate credentials and keep authorization secrets outside model input.',
  'TypeScript packages expose explicit public entry points and keep implementation ownership within each domain.',
  'Worker cancellation rejects the waiting caller while native inference retains capacity until settlement.',
  'Filesystem tools check real paths, stable file hashes and atomic replacement before changing workspace files.',
  'Memory recall selects confirmed facts, validates current scope and keeps ordinary learning suggestions disabled.',
  'Session logs persist complete messages and tool outcomes while transient streaming deltas stay in memory.',
  'Artifact delivery freezes immutable bytes and verifies the producing command before publishing a download.',
  'Subagent execution isolates task input, explicit references, mutable work state and inherited tool permissions.',
  'PDF inspection reads bounded pages and separates text extraction from visual verification and OCR.',
  'Network policy validates resolved destinations and applies controlled transport to third party requests.',
  '应用模块明确职责，工作区与用户记忆分开管理；历史引用只是资料，不能扩大工具授权。',
  '索引代际切换保留当前可用结果，后台处理支持取消，重启后复用合法的持久向量。',
] as const;

function text(identifier: string, index: number, length: number): string {
  const topic = TOPICS[index % TOPICS.length];
  if (topic === undefined) throw new Error('Missing fixed performance topic');
  const header = `Reference ${identifier}. ${topic} `;
  const paragraph = `${topic} Technical note ${index}: verify scope, source identity, current state and cleanup. `;
  const body = `${header}${paragraph.repeat(Math.ceil(length / paragraph.length))}`;
  return `${body.slice(0, length - 1)}.`;
}

/** Fixed identifiers and complete 4800-code-unit messages exercise the production chunker without sampling. */
export function searchPerformanceCorpus(): SearchPerformanceSource[] {
  const sources: SearchPerformanceSource[] = [];
  for (let index = 0; index < SEARCH_PERFORMANCE_MESSAGE_COUNT; index += 1) {
    const suffix = String(index).padStart(4, '0');
    const identifier = `pmessage${suffix}`;
    sources.push({
      id: `message:performance-message-${suffix}`,
      identifier,
      kind: 'message',
      workspaceId: SEARCH_PERFORMANCE_WORKSPACES[index % 2] ?? null,
      text: text(identifier, index, 4800),
    });
  }
  for (let index = 0; index < SEARCH_PERFORMANCE_MEMORY_COUNT; index += 1) {
    const suffix = String(index).padStart(4, '0');
    const identifier = `pmemory${suffix}`;
    sources.push({
      id: `memory:performance-memory-${suffix}`,
      identifier,
      kind: 'memory',
      workspaceId: null,
      text: text(identifier, index + 7, 480),
    });
  }
  return sources;
}

/** Thirty distinct identifiers cover both message workspaces and confirmed user memories. */
export function searchPerformanceQueries(
  corpus: readonly SearchPerformanceSource[],
): SearchPerformanceSource[] {
  const messages = corpus.filter((source) => source.kind === 'message');
  const memories = corpus.filter((source) => source.kind === 'memory');
  return [
    ...Array.from({ length: 24 }, (_value, index) => messages[index * 37]),
    ...Array.from({ length: 6 }, (_value, index) => memories[index * 53]),
  ].map((source) => {
    if (source === undefined) throw new Error('Missing fixed performance query source');
    return source;
  });
}
