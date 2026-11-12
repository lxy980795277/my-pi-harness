import { MemoryService } from '@my-pi-harness/memory';
import {
  RuntimeError,
  type RunMemoryPort,
  type RunMemoryRequest,
  type RunMemoryMutationContext,
} from '@my-pi-harness/agent-runtime';
import type {
  MemoryCreateInput,
  MemorySaveInput,
  MemoryAgentUpdateInput,
  MemoryAgentDeleteInput,
  MemoryCurrentStatus,
  MemoryListInput,
  MemoryPage,
  MemorySearchResult,
  MemoryMutationResult,
  MemorySettings,
  MemoryForgetInput,
  MemorySettingsInput,
  MemoryUpdateInput,
} from '@my-pi-harness/protocol';
import type {
  MemoryAccess,
  MemoryMutationAccess,
  MemoryRequestSnapshot,
} from '@my-pi-harness/protocol/internal';
import type { ProfileStore } from '@my-pi-harness/storage';
import type { WorkspaceService } from '../workspaces/service';
import type { SearchService } from '../search/service';
import { MemoryRetrieval } from './retrieval';
import type { LocalRerankerView } from '../search/local-model-resource';

/** Authenticate management and derive root/child access from current host facts. */
export class MemoryApplicationService implements RunMemoryPort {
  private readonly domain: MemoryService;
  private readonly retrieval: MemoryRetrieval;

  public constructor(
    private readonly store: ProfileStore,
    private readonly workspaces: WorkspaceService,
    search: Pick<SearchService, 'queryScoped'>,
    private readonly reranker: Pick<LocalRerankerView, 'status' | 'rerank'>,
  ) {
    this.domain = new MemoryService(store.memory);
    this.retrieval = new MemoryRetrieval(this.domain, search, reranker);
  }

  private owner(): string {
    const owner = this.store.auth.profileOwner();
    if (!owner) throw new RuntimeError('MEMORY_IDENTITY_REQUIRED', '请先登录后管理记忆。');
    return owner.id;
  }

  public list(input?: MemoryListInput): MemoryPage {
    return this.domain.list(this.owner(), input);
  }

  public statuses(ids: readonly string[]): MemoryCurrentStatus[] {
    return this.domain.statuses(this.owner(), ids);
  }

  public async create(input: MemoryCreateInput): Promise<MemoryMutationResult> {
    if (input.scope.kind === 'workspace')
      await this.workspaces.requireAvailable(input.scope.workspaceId);
    return this.domain.create(this.owner(), input);
  }

  public update(id: string, input: MemoryUpdateInput): MemoryMutationResult {
    return this.domain.update(this.owner(), id, input);
  }

  public forget(id: string, input: MemoryForgetInput): MemoryMutationResult {
    return this.domain.forget(this.owner(), id, input);
  }

  public settings(): MemorySettings {
    return this.domain.settings(this.owner());
  }

  public updateSettings(input: MemorySettingsInput): MemorySettings {
    return this.domain.updateSettings(this.owner(), input);
  }

  private mutationAccess(
    input: RunMemoryMutationContext,
    toolCallId: string,
  ): MemoryMutationAccess {
    input.signal.throwIfAborted();
    if (!input.source)
      throw new RuntimeError('MEMORY_SOURCE_REQUIRED', '记忆操作缺少已消费的人类输入来源。');
    return {
      ownerUserId: this.owner(),
      sessionId: input.sessionId,
      branchId: input.branchId,
      runId: input.runId,
      source: input.source,
      toolCallId,
    };
  }

  public saveMemory(
    context: RunMemoryMutationContext,
    input: MemorySaveInput,
    toolCallId: string,
  ): Promise<MemoryMutationResult> {
    context.signal.throwIfAborted();
    return Promise.resolve(
      this.domain.saveFromAgent(input, this.mutationAccess(context, toolCallId)),
    );
  }

  public learnMemory(
    context: RunMemoryMutationContext,
    input: MemorySaveInput,
    toolCallId: string,
  ): Promise<MemoryMutationResult> {
    context.signal.throwIfAborted();
    return Promise.resolve(
      this.domain.learnFromAgent(input, this.mutationAccess(context, toolCallId)),
    );
  }

  public updateMemory(
    context: RunMemoryMutationContext,
    input: MemoryAgentUpdateInput,
    toolCallId: string,
  ): Promise<MemoryMutationResult> {
    context.signal.throwIfAborted();
    return Promise.resolve(
      this.domain.updateFromAgent(input, this.mutationAccess(context, toolCallId)),
    );
  }

  public deleteMemory(
    context: RunMemoryMutationContext,
    input: MemoryAgentDeleteInput,
    toolCallId: string,
  ): Promise<MemoryMutationResult> {
    context.signal.throwIfAborted();
    return Promise.resolve(
      this.domain.deleteFromAgent(input, this.mutationAccess(context, toolCallId)),
    );
  }

  private access(input: RunMemoryRequest): MemoryAccess {
    input.signal.throwIfAborted();
    const session = this.store.getSession(input.sessionId);
    if (!session || session.workspaceId !== input.workspaceId)
      throw new RuntimeError('MEMORY_SCOPE_CONFLICT', '记忆请求的会话范围已变化。');
    const task =
      input.taskId === undefined
        ? undefined
        : this.store.getAgentTask(input.sessionId, input.taskId);
    if (input.taskId !== undefined && task === undefined)
      throw new RuntimeError('MEMORY_SCOPE_CONFLICT', '记忆请求的子任务不存在。');
    return {
      ownerUserId: this.owner(),
      workspaceId: session.workspaceId,
      includeUser: input.taskId === undefined,
      ...(task === undefined ? {} : { userMemoryIds: task.userMemoryIds ?? [] }),
    };
  }

  public async readSnapshot(input: RunMemoryRequest): Promise<MemoryRequestSnapshot> {
    const access = this.access(input);
    const snapshot = this.domain.snapshot(access);
    const query = input.query.trim();
    if (
      !snapshot.settings.allowUse ||
      !query ||
      !snapshot.candidates.some((entry) => entry.enabled && entry.mode === 'relevant')
    )
      return this.domain.select(snapshot, [], { query, mode: 'fixed' });
    if (this.reranker.status().state !== 'ready')
      return this.domain.select(snapshot, [], {
        query,
        mode: 'fixed',
        verification: 'unavailable',
      });
    try {
      const result = await this.retrieval.search(access, query, input.signal, {
        mode: 'relevant',
        verify: true,
      });
      input.signal.throwIfAborted();
      return this.domain.select(snapshot, result.candidates, {
        query,
        mode: result.mode,
        truncated: result.truncated,
        verification: result.verification,
      });
    } catch (error) {
      input.signal.throwIfAborted();
      if (!(error instanceof RuntimeError) || error.code !== 'SEARCH_INDEX_CHANGED') throw error;
      return this.domain.select(snapshot, [], { query, mode: 'lexical', truncated: true });
    }
  }

  public isCurrent(input: RunMemoryRequest, fingerprint: string): boolean {
    return this.domain.isCurrent(this.access(input), fingerprint);
  }

  public canUse(input: RunMemoryRequest): boolean {
    const access = this.access(input);
    return this.domain.settings(access.ownerUserId).allowUse;
  }

  public validateDelegation(input: RunMemoryRequest, ids: readonly string[]): readonly string[] {
    const access = this.access(input);
    if (!this.domain.settings(access.ownerUserId).allowUse)
      throw new RuntimeError('MEMORY_USE_DISABLED', '记忆使用已关闭，不能向子任务转交记忆。');
    const entries = this.domain.entries(access, ids);
    const permitted = new Set(
      entries
        .filter((entry) => entry.enabled && entry.scope.kind === 'user')
        .map((entry) => entry.id),
    );
    if (ids.some((id) => !permitted.has(id)))
      throw new RuntimeError('MEMORY_SCOPE_CONFLICT', '只能转交当前有权使用且已启用的用户记忆。');
    return [...new Set(ids)];
  }

  public async searchMemories(
    input: RunMemoryRequest,
    query: string,
    limit: number,
  ): Promise<MemorySearchResult> {
    if (!query.trim()) throw new RuntimeError('MEMORY_QUERY_INVALID', '请输入记忆搜索内容。');
    const access = this.access(input);
    if (!this.domain.settings(access.ownerUserId).allowUse)
      throw new RuntimeError('MEMORY_USE_DISABLED', '记忆使用已关闭。');
    const snapshot = this.domain.snapshot(access);
    const result = await this.retrieval.search(access, query, input.signal, { priority: 'tool' });
    input.signal.throwIfAborted();
    if (!this.domain.isCurrent(this.access(input), snapshot.fingerprint))
      throw new RuntimeError('MEMORY_CHANGED', '记忆已变化，请重新搜索。');
    return {
      mode: result.mode,
      truncated: result.truncated,
      entries: result.candidates.slice(0, limit).map(({ entry }) => ({
        id: entry.id,
        scope: entry.scope,
        mode: entry.mode,
        category: entry.category,
        revision: entry.revision,
        source: entry.source,
        body: entry.body,
      })),
    };
  }
}
