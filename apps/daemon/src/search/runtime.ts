import {
  RuntimeError,
  type RunSearchContext,
  type RunSearchGrant,
  type RunSearchPort,
} from '@my-pi-harness/agent-runtime';
import type {
  SearchQueryResult,
  SearchSourceExcerpt,
  SearchSourceSelection,
} from '@my-pi-harness/protocol';
import { sameSearchSource } from '@my-pi-harness/protocol';
import type { SearchAccess } from '@my-pi-harness/protocol/internal';
import type { ProfileStore } from '@my-pi-harness/storage';
import type { SearchService } from './service';

/** Model search and exact human quotations have separate host-owned read permissions. */
export class SessionSearchService implements RunSearchPort {
  public constructor(
    private readonly store: ProfileStore,
    private readonly search: SearchService,
  ) {}

  public async searchSessions(
    context: RunSearchContext,
    query: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<SearchQueryResult> {
    signal.throwIfAborted();
    const access = this.runAccess(context);
    const result = await this.search.queryScoped(access, { query, limit }, signal, {
      priority: 'tool',
    });
    signal.throwIfAborted();
    this.runAccess(context);
    return result;
  }

  public readSearchSource(
    context: RunSearchContext,
    selection: SearchSourceSelection,
    grant: RunSearchGrant,
    signal: AbortSignal,
  ): Promise<SearchSourceExcerpt> {
    signal.throwIfAborted();
    const current = this.runAccess(context);
    if (!sameSearchSource(selection, grant.selection)) unavailable();
    let access = current;
    if (grant.kind === 'quote') {
      if (selection.start < grant.selection.start || selection.end > grant.selection.end)
        unavailable();
      access = this.search.selectionAccess(selection);
    } else if (
      selection.source.kind !== 'message' ||
      selection.target.kind !== 'message' ||
      selection.target.taskId !== undefined
    ) {
      unavailable();
    }
    const result = this.store.search.readSelection(access, selection);
    if (!result) unavailable();
    signal.throwIfAborted();
    return Promise.resolve(result);
  }

  public resolveQuote(sessionId: string, selection: SearchSourceSelection): SearchSourceExcerpt {
    if (!this.store.getSession(sessionId)) unavailable();
    const result = this.store.search.readSelection(
      this.search.selectionAccess(selection),
      selection,
    );
    if (!result) unavailable();
    return result;
  }

  public validateQuotes(context: RunSearchContext, quotes: readonly SearchSourceSelection[]): void {
    this.runAccess(context);
    for (const quote of quotes) this.resolveQuote(context.sessionId, quote);
  }

  private runAccess(context: RunSearchContext): SearchAccess {
    const session = this.store.getSession(context.sessionId);
    if (
      !session ||
      context.taskId !== undefined ||
      session.workspaceId !== context.workspaceId ||
      session.activeBranchId !== context.branchId ||
      session.activeRunId !== context.runId
    )
      throw new RuntimeError('SEARCH_SCOPE_CONFLICT', '当前执行未获准搜索历史对话。');
    return {
      ...this.search.access({ workspaceId: session.workspaceId, kind: 'message' }),
      excludeSessionId: session.id,
    };
  }
}

function unavailable(): never {
  throw new RuntimeError('SEARCH_SOURCE_NOT_FOUND', '来源已变化或不可用，请重新搜索并选择。');
}
