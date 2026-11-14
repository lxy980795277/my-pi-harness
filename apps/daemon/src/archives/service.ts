import { constants, createReadStream, openSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import {
  resolveRunModel,
  type ModelGateway,
  type SessionRuntime,
} from '@my-pi-harness/agent-runtime';
import type {
  SessionArchiveJob,
  SessionArchiveImportBinding,
  SessionArchiveImportReceipt,
  SessionArchiveJobsPage,
  SessionArchiveJobsQuery,
  SessionSummary,
} from '@my-pi-harness/protocol';
import { StorageError, type ProfileStore } from '@my-pi-harness/storage';
import type { WorkspaceService } from '../workspaces/service';
import { readArchive, writeArchive, type ExtractedArchive } from './format';
import { ArchiveError } from './errors';
import { ARCHIVE_LIMITS } from './limits';
import { archiveHistoryPage, archiveHistoryPosition } from './history';

interface ArchiveState {
  value: SessionArchiveJob;
  controller: AbortController;
  task: Promise<void> | undefined;
  directory: string | undefined;
  source: ExtractedArchive | undefined;
  file: string | undefined;
}
export interface SessionArchiveServiceOptions {
  store: ProfileStore;
  runtime: Pick<SessionRuntime, 'importedBindingCommand'>;
  gateway: Pick<ModelGateway, 'resolve'>;
  workspaces: Pick<WorkspaceService, 'requireAvailable'>;
  profileDirectory: string;
  onError(error: unknown): void;
}
export interface ArchiveDownload {
  content: Readable;
  bytes: number;
}

function receiptJob(receipt: SessionArchiveImportReceipt): SessionArchiveJob {
  return {
    operationId: receipt.operationId,
    kind: 'import',
    status: receipt.status,
    phase: receipt.status,
    bytesProcessed: 0,
    totalBytes: null,
    archiveSha256: receipt.archiveSha256,
    sessionId: receipt.sessionId,
    preview: null,
    downloadAvailable: false,
    error: receipt.error,
    createdAt: receipt.createdAt,
    updatedAt: receipt.updatedAt,
  };
}

/** Owns temporary transfer resources; storage alone publishes durable imported session facts. */
export class SessionArchiveService {
  private accepting = true;
  private readonly jobs = new Map<string, ArchiveState>();
  private readonly tasks = new Set<Promise<void>>();
  private readonly downloads = new Set<Readable>();
  private readonly downloading = new Map<string, number>();
  private closing: Promise<void> | undefined;
  private readonly backgroundFailures: unknown[] = [];
  private constructor(
    private readonly options: SessionArchiveServiceOptions,
    private readonly directory: string,
  ) {}

  public static async create(
    options: SessionArchiveServiceOptions,
  ): Promise<SessionArchiveService> {
    return new SessionArchiveService(
      options,
      await realpath(await mkdtemp(join(tmpdir(), 'my-pi-session-archives-'))),
    );
  }

  public get(operationId: string): SessionArchiveJob {
    const state = this.jobs.get(operationId);
    const receipt = this.options.store.getSessionArchiveImport(operationId);
    if (state === undefined) {
      if (receipt === undefined)
        throw new ArchiveError('ARCHIVE_OPERATION_NOT_FOUND', '未找到此归档操作。', 404);
      return receiptJob(receipt);
    }
    if (receipt !== undefined && state.value.kind === 'import')
      return {
        ...state.value,
        ...receiptJob(receipt),
        preview: state.value.preview,
        bytesProcessed: state.value.bytesProcessed,
        totalBytes: state.value.totalBytes,
      };
    return { ...state.value };
  }

  public list(query: SessionArchiveJobsQuery): SessionArchiveJobsPage {
    const before = archiveHistoryPosition(query.cursor);
    const limit = query.limit ?? 25;
    const receipts = this.options.store.listSessionArchiveImports({
      ...(before === undefined ? {} : { before }),
      limit: limit + 1,
    });
    const jobs = new Map(receipts.map((receipt) => [receipt.operationId, receiptJob(receipt)]));
    for (const id of this.jobs.keys()) jobs.set(id, this.get(id));
    return archiveHistoryPage(jobs.values(), before, limit);
  }

  public export(operationId: string, sessionId: string): SessionArchiveJob {
    const existing = this.jobs.get(operationId);
    if (existing !== undefined) {
      if (existing.value.kind !== 'export' || existing.value.sessionId !== sessionId)
        throw new ArchiveError(
          'ARCHIVE_OPERATION_CONFLICT',
          '此操作 ID 已用于不同的归档请求。',
          409,
        );
      return this.get(operationId);
    }
    const state = this.reserve(operationId, 'export', sessionId, 'collecting');
    state.task = this.run(state, async (signal) => {
      const source = await this.options.store.createSessionArchive(sessionId, {
        signal,
        resolveSkillDirectory: (skill) =>
          join(this.options.profileDirectory, 'skill-versions', skill.selection.contentHash),
      });
      try {
        state.directory = await this.stage();
        const file = join(state.directory, 'session.tar.gz');
        this.update(state, { phase: 'packing' });
        const packed = await writeArchive(source, file, signal, (bytes) =>
          this.update(state, { bytesProcessed: bytes }),
        );
        signal.throwIfAborted();
        state.file = file;
        this.update(state, {
          status: 'completed',
          phase: 'completed',
          downloadAvailable: true,
          bytesProcessed: packed.bytes,
          totalBytes: packed.bytes,
          archiveSha256: packed.sha256,
        });
        await this.releaseOldExports(operationId);
      } finally {
        source.release();
      }
    });
    return this.get(operationId);
  }

  /** Upload and validation remain request-owned; they never publish a conversation implicitly. */
  public async upload(
    operationId: string,
    input: Readable,
    requestSignal: AbortSignal,
  ): Promise<SessionArchiveJob> {
    const state = this.reserve(operationId, 'import', null, 'uploading');
    const abort = (): void => state.controller.abort();
    if (requestSignal.aborted) abort();
    requestSignal.addEventListener('abort', abort, { once: true });
    try {
      await this.run(state, async (ownedSignal) => {
        const signal = AbortSignal.any([ownedSignal, requestSignal]);
        state.directory = await this.stage();
        state.source = await readArchive(input, state.directory, signal, (bytes) =>
          this.update(state, { bytesProcessed: bytes }),
        );
        this.update(state, {
          phase: 'validating',
          archiveSha256: state.source.archiveSha256,
          totalBytes: state.source.bytes,
          sessionId: state.source.manifest.sessionId,
        });
        const preview = await this.options.store.previewSessionArchive(
          state.source,
          state.source.archiveSha256,
          { signal },
        );
        signal.throwIfAborted();
        this.update(state, { preview, status: 'ready', phase: 'ready' });
      });
    } finally {
      requestSignal.removeEventListener('abort', abort);
    }
    return this.get(operationId);
  }

  public commit(operationId: string, archiveSha256: string): SessionArchiveJob {
    const receipt = this.options.store.getSessionArchiveImport(operationId);
    if (receipt !== undefined) {
      if (receipt.archiveSha256 !== archiveSha256)
        throw new ArchiveError(
          'ARCHIVE_OPERATION_CONFLICT',
          '此操作 ID 已绑定不同的归档内容。',
          409,
        );
      return this.get(operationId);
    }
    const state = this.jobs.get(operationId);
    if (state === undefined || state.value.kind !== 'import' || state.source === undefined)
      throw new ArchiveError('ARCHIVE_OPERATION_NOT_FOUND', '请重新上传归档后再确认导入。', 404);
    if (state.value.archiveSha256 !== archiveSha256)
      throw new ArchiveError('ARCHIVE_OPERATION_CONFLICT', '归档内容与已预检文件不符。', 409);
    if (state.task !== undefined) return this.get(operationId);
    if (state.value.status !== 'ready' || state.value.preview?.canImport !== true)
      throw new ArchiveError('ARCHIVE_IMPORT_REJECTED', '归档尚未通过预检，不能导入。', 409);
    if (!this.accepting) throw new ArchiveError('ARCHIVE_CLOSED', '归档服务已关闭。', 409);
    const source = state.source;
    state.controller = new AbortController();
    this.update(state, { status: 'running', phase: 'validating' });
    state.task = this.run(state, async (signal) => {
      const result = await this.options.store.importSessionArchive(
        operationId,
        source,
        archiveSha256,
        { signal },
      );
      this.update(state, {
        ...receiptJob(result),
        preview: state.value.preview,
        bytesProcessed: state.value.bytesProcessed,
        totalBytes: state.value.totalBytes,
      });
      await this.removeStage(state);
    });
    return this.get(operationId);
  }

  public async cancel(operationId: string): Promise<SessionArchiveJob> {
    const state = this.jobs.get(operationId);
    if (state === undefined) return this.get(operationId);
    const receipt = this.options.store.getSessionArchiveImport(operationId);
    if (receipt !== undefined || state.value.status === 'completed') return this.get(operationId);
    this.update(state, { status: 'cancelled', phase: 'cancelled' });
    const task = state.task;
    state.controller.abort();
    await task;
    if (this.options.store.getSessionArchiveImport(operationId) !== undefined)
      return this.get(operationId);
    await this.removeStage(state);
    this.update(state, { status: 'cancelled', phase: 'cancelled', error: null });
    return this.get(operationId);
  }

  public download(operationId: string): ArchiveDownload {
    if (!this.accepting) throw new ArchiveError('ARCHIVE_CLOSED', '归档服务已关闭。', 409);
    if (this.downloads.size >= ARCHIVE_LIMITS.concurrentDownloads)
      throw new ArchiveError('ARCHIVE_BUSY', '归档下载数量已达上限，请稍后重试。', 409);
    const state = this.jobs.get(operationId);
    if (state === undefined || state.file === undefined || !state.value.downloadAvailable)
      throw new ArchiveError('ARCHIVE_DOWNLOAD_EXPIRED', '临时归档文件已释放，请重新导出。', 410);
    if (
      state.value.sessionId === null ||
      this.options.store.getSession(state.value.sessionId) === undefined
    )
      throw new ArchiveError('SESSION_NOT_FOUND', '会话不存在或已归档。', 404);
    const content = createReadStream(state.file, {
      fd: openSync(state.file, constants.O_RDONLY | constants.O_NOFOLLOW),
      autoClose: true,
    });
    this.downloads.add(content);
    this.downloading.set(operationId, (this.downloading.get(operationId) ?? 0) + 1);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.downloads.delete(content);
      const remaining = (this.downloading.get(operationId) ?? 1) - 1;
      if (remaining === 0) this.downloading.delete(operationId);
      else this.downloading.set(operationId, remaining);
      if (this.accepting) this.ownTask(this.releaseOldExports());
    };
    content.once('close', release);
    return { content, bytes: state.value.bytesProcessed };
  }

  public bind(
    sessionId: string,
    binding: SessionArchiveImportBinding,
    signal: AbortSignal,
  ): Promise<SessionSummary> {
    return this.options.runtime.importedBindingCommand(sessionId, async () => {
      const model = await resolveRunModel(this.options.gateway, binding, signal);
      try {
        if (binding.workspaceId !== null)
          await this.options.workspaces.requireAvailable(binding.workspaceId);
        signal.throwIfAborted();
        this.options.store.bindSessionArchive(sessionId, binding);
        const session = this.options.store.getSession(sessionId);
        if (session === undefined) throw new ArchiveError('SESSION_NOT_FOUND', '会话不存在。', 404);
        return session;
      } finally {
        model.release();
      }
    });
  }

  public stopAccepting(): void {
    this.accepting = false;
    for (const state of this.jobs.values()) state.controller.abort();
  }

  public close(): Promise<void> {
    this.closing ??= (async () => {
      this.stopAccepting();
      await Promise.allSettled(this.tasks);
      const downloads = [...this.downloads];
      for (const content of downloads) content.destroy();
      await Promise.allSettled(downloads.map((content) => finished(content, { cleanup: true })));
      await Promise.allSettled([...this.jobs.values()].map((state) => this.removeStage(state)));
      this.jobs.clear();
      await rm(this.directory, { recursive: true, force: true });
      if (this.backgroundFailures.length !== 0)
        throw new AggregateError(this.backgroundFailures, 'Archive background work failed');
    })();
    return this.closing;
  }

  private reserve(
    operationId: string,
    kind: SessionArchiveJob['kind'],
    sessionId: string | null,
    phase: SessionArchiveJob['phase'],
  ): ArchiveState {
    if (!this.accepting) throw new ArchiveError('ARCHIVE_CLOSED', '归档服务已关闭。', 409);
    if (
      this.jobs.has(operationId) ||
      this.options.store.getSessionArchiveImport(operationId) !== undefined
    )
      throw new ArchiveError(
        'ARCHIVE_OPERATION_CONFLICT',
        '此操作 ID 已存在，请先查询原操作。',
        409,
      );
    const retained = [...this.jobs.values()].filter(
      (state) => state.task !== undefined || state.value.status === 'ready',
    );
    if (retained.length >= ARCHIVE_LIMITS.concurrentJobs)
      throw new ArchiveError('ARCHIVE_BUSY', '请先完成或取消正在进行的归档操作。', 409);
    if (this.jobs.size >= ARCHIVE_LIMITS.retainedJobs) {
      const oldest = [...this.jobs.values()].find(
        (state) => state.task === undefined && state.directory === undefined,
      );
      if (oldest === undefined)
        throw new ArchiveError('ARCHIVE_BUSY', '归档操作记录已满，请稍后重试。', 409);
      this.jobs.delete(oldest.value.operationId);
    }
    const at = Date.now();
    const state: ArchiveState = {
      value: {
        operationId,
        kind,
        status: 'running',
        phase,
        bytesProcessed: 0,
        totalBytes: null,
        archiveSha256: null,
        sessionId,
        preview: null,
        downloadAvailable: false,
        error: null,
        createdAt: at,
        updatedAt: at,
      },
      controller: new AbortController(),
      task: undefined,
      directory: undefined,
      source: undefined,
      file: undefined,
    };
    this.jobs.set(operationId, state);
    return state;
  }

  private run(
    state: ArchiveState,
    operation: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    const timer = setTimeout(() => state.controller.abort(), ARCHIVE_LIMITS.operationMs);
    timer.unref();
    const work = Promise.resolve().then(async () => {
      try {
        await operation(state.controller.signal);
      } catch (cause) {
        const receipt = this.options.store.getSessionArchiveImport(state.value.operationId);
        if (receipt !== undefined) this.update(state, receiptJob(receipt));
        else
          this.update(state, {
            status: state.controller.signal.aborted ? 'cancelled' : 'failed',
            phase: state.controller.signal.aborted ? 'cancelled' : 'failed',
            error:
              cause instanceof ArchiveError
                ? cause.message
                : cause instanceof StorageError
                  ? '归档资源或会话记录未通过完整性校验。'
                  : '归档操作未能完成。',
          });
        if (
          !(cause instanceof ArchiveError || cause instanceof StorageError) &&
          !state.controller.signal.aborted
        )
          this.options.onError(cause);
        // Storage's durable publication plan owns independent copies after acceptance.
        await this.removeStage(state);
      } finally {
        clearTimeout(timer);
        state.task = undefined;
      }
    });
    this.ownTask(work);
    state.task = work;
    return work;
  }

  /** Every background failure has an owner through shutdown, including diagnostic and cleanup errors. */
  private ownTask(work: Promise<void>): void {
    const task = work
      .catch((error: unknown) => {
        this.backgroundFailures.push(error);
        try {
          this.options.onError(error);
        } catch (diagnostic) {
          this.backgroundFailures.push(diagnostic);
        }
      })
      .finally(() => this.tasks.delete(task));
    this.tasks.add(task);
  }

  private update(state: ArchiveState, patch: Partial<SessionArchiveJob>): void {
    state.value = { ...state.value, ...patch, updatedAt: Date.now() };
  }
  private stage(): Promise<string> {
    return mkdtemp(join(this.directory, 'operation-'));
  }
  private async removeStage(state: ArchiveState): Promise<void> {
    const directory = state.directory;
    state.source = undefined;
    state.file = undefined;
    this.update(state, { downloadAvailable: false });
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    if (state.directory === directory) state.directory = undefined;
  }
  private async releaseOldExports(protectedId?: string): Promise<void> {
    const completed = [...this.jobs.values()].filter(
      (state) => state.value.kind === 'export' && state.file !== undefined,
    );
    while (completed.length > ARCHIVE_LIMITS.retainedExports) {
      const latest = protectedId ?? completed.at(-1)?.value.operationId;
      const index = completed.findIndex(
        (state) =>
          state.value.operationId !== latest && !this.downloading.has(state.value.operationId),
      );
      // Leased older files temporarily exceed retention; releasing their download retries collection.
      if (index === -1) return;
      const previous = completed.splice(index, 1)[0];
      if (previous !== undefined) await this.removeStage(previous);
    }
  }
}
