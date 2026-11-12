import type {
  SearchIndexStatus,
  SearchModelStatus,
  SearchRerankerStatus,
  SearchQueryInput,
  SearchQueryResult,
  SearchScope,
  SearchSourceSelection,
  SearchSourceReadInput,
  SearchSourceWindow,
} from '@my-pi-harness/protocol';
import type { ProfileStore } from '@my-pi-harness/storage';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import type { SearchAccess } from '@my-pi-harness/protocol/internal';
import type { LocalEmbeddingView, LocalRerankerView } from './local-model-resource';
import { SearchIndexer } from './indexer';
import { PersistentSearchQuery, type SearchExecutionOptions } from './query';

export interface SearchServiceOptions {
  store: ProfileStore;
  embedding: LocalEmbeddingView;
  reranker: Pick<LocalRerankerView, 'status' | 'prepare'>;
  onError(error: unknown): void;
}

type ResourceKind = 'embedding' | 'reranker';

interface Preparation {
  controller: AbortController;
  promise: Promise<void>;
}

/** Authenticated use cases share a single resource and derived index owner. */
export class SearchService {
  private readonly indexer: SearchIndexer;
  private readonly query: PersistentSearchQuery;
  private readonly lifetime = new AbortController();
  private readonly queries = new Set<Promise<SearchQueryResult>>();
  private readonly preparations = new Map<ResourceKind, Preparation>();
  private closed = false;
  private closing: Promise<void> | undefined;

  public constructor(private readonly options: SearchServiceOptions) {
    this.indexer = new SearchIndexer(options);
    this.query = new PersistentSearchQuery({
      repository: options.store.search,
      embedding: options.embedding,
    });
  }

  public start(): void {
    this.indexer.start();
  }
  public modelStatus(): SearchModelStatus {
    return this.options.embedding.status();
  }
  public indexStatus(): SearchIndexStatus {
    return this.options.store.search.status(this.options.embedding.status().signature);
  }

  public rerankerStatus(): SearchRerankerStatus {
    return this.options.reranker.status();
  }

  public prepare(): SearchModelStatus {
    this.prepareResource('embedding');
    return this.modelStatus();
  }

  public prepareReranker(): SearchRerankerStatus {
    this.prepareResource('reranker');
    return this.rerankerStatus();
  }

  private prepareResource(kind: ResourceKind): void {
    this.ensureOpen();
    if (this.preparations.has(kind)) return;
    const controller = new AbortController();
    const resource = kind === 'embedding' ? this.options.embedding : this.options.reranker;
    const promise = resource.prepare(controller.signal);
    const operation = { controller, promise };
    this.preparations.set(kind, operation);
    promise.then(
      () => {
        if (this.preparations.get(kind) === operation) this.preparations.delete(kind);
        if (!this.closed && kind === 'embedding') this.indexer.wake();
      },
      (error: unknown) => {
        if (this.preparations.get(kind) === operation) this.preparations.delete(kind);
        if (!cancelledOperation(controller.signal, error)) this.options.onError(error);
      },
    );
  }

  public async cancelPreparation(): Promise<SearchModelStatus> {
    await this.cancelResource('embedding');
    return this.modelStatus();
  }

  public async cancelRerankerPreparation(): Promise<SearchRerankerStatus> {
    await this.cancelResource('reranker');
    return this.rerankerStatus();
  }

  private async cancelResource(kind: ResourceKind): Promise<void> {
    const operation = this.preparations.get(kind);
    if (operation) {
      operation.controller.abort();
      try {
        await operation.promise;
      } catch (error) {
        if (!cancelledOperation(operation.controller.signal, error)) throw error;
      }
    }
  }

  public rebuild(): SearchIndexStatus {
    this.ensureOpen();
    this.indexer.rebuild();
    return this.indexStatus();
  }

  public access(scope: SearchScope = {}): SearchAccess {
    const owner = this.options.store.auth.profileOwner();
    if (!owner) throw new RuntimeError('SEARCH_IDENTITY_REQUIRED', '请先登录。');
    if (scope.allWorkspaces === true && scope.workspaceId !== undefined)
      throw new RuntimeError('SEARCH_SCOPE_INVALID', '全工作区筛选不能同时指定单个工作区。');
    if (
      scope.createdFrom !== undefined &&
      scope.createdTo !== undefined &&
      scope.createdFrom > scope.createdTo
    )
      throw new RuntimeError('SEARCH_SCOPE_INVALID', '搜索开始时间不能晚于结束时间。');
    let selected = scope;
    if (scope.allWorkspaces !== true && scope.workspaceId === undefined)
      selected = { ...scope, workspaceId: null };
    return {
      ownerUserId: owner.id,
      scope: selected,
    };
  }

  /** An explicit human selection permits only that source's current membership, including history. */
  public selectionAccess(selection: SearchSourceSelection): SearchAccess {
    if (selection.end <= selection.start || selection.end - selection.start > 8000)
      throw new RuntimeError('SEARCH_SELECTION_INVALID', '请选择不超过 8000 字符的非空原文。');
    const target = selection.target;
    if (target.kind === 'memory')
      return this.access({ allWorkspaces: true, kind: 'memory', includeArchived: true });
    return this.access({
      allWorkspaces: true,
      kind: 'message',
      sessionId: target.sessionId,
      branchId: target.branchId,
      ...(target.taskId === undefined ? {} : { taskId: target.taskId }),
      includeArchived: true,
    });
  }

  public source(input: SearchSourceReadInput): SearchSourceWindow {
    this.ensureOpen();
    const result = this.options.store.search.sourceWindow(
      this.selectionAccess(input.selection),
      input,
    );
    if (!result)
      throw new RuntimeError('SEARCH_SOURCE_NOT_FOUND', '来源已变化或不可用，请重新搜索并选择。');
    return result;
  }

  public async search(input: SearchQueryInput, signal: AbortSignal): Promise<SearchQueryResult> {
    this.ensureOpen();
    return await this.queryScoped(this.access(input.scope), input, signal);
  }

  /** Host consumers provide their own narrower access; all queries share cancellation and shutdown. */
  public async queryScoped(
    access: SearchAccess,
    input: Pick<SearchQueryInput, 'query' | 'limit'>,
    signal: AbortSignal,
    options: SearchExecutionOptions = {},
  ): Promise<SearchQueryResult> {
    this.ensureOpen();
    if (!input.query.trim()) throw new RuntimeError('SEARCH_QUERY_INVALID', '请输入搜索内容。');
    const requestSignal = AbortSignal.any([signal, this.lifetime.signal]);
    requestSignal.throwIfAborted();
    const operation = this.query.run(access, input, requestSignal, options).then(({ result }) => {
      requestSignal.throwIfAborted();
      return result;
    });
    this.queries.add(operation);
    try {
      const result = await operation;
      requestSignal.throwIfAborted();
      return result;
    } finally {
      this.queries.delete(operation);
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new RuntimeError('SEARCH_CLOSED', '搜索服务已关闭。');
  }

  public close(): Promise<void> {
    this.closing ??= (async () => {
      this.closed = true;
      this.lifetime.abort();
      const failures: unknown[] = [];
      const queries = await Promise.allSettled([...this.queries]);
      for (const result of queries) {
        if (
          result.status === 'rejected' &&
          !cancelledOperation(this.lifetime.signal, result.reason)
        )
          failures.push(result.reason);
      }
      for (const dispose of [
        () => this.cancelResource('embedding'),
        () => this.cancelResource('reranker'),
        () => this.indexer.close(),
      ]) {
        try {
          await dispose();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, 'Search shutdown failed');
    })();
    return this.closing;
  }
}

function cancelledOperation(signal: AbortSignal, error: unknown): boolean {
  return signal.aborted && error instanceof Error && error.name === 'AbortError';
}
