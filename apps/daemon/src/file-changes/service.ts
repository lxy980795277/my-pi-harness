import { randomUUID } from 'node:crypto';
import type { FileChangeImage, Workspace } from '@my-pi-harness/protocol';
import type {
  FileChangeRecord,
  FileOperationPrepare,
  FileOperationRecord,
} from '@my-pi-harness/protocol/internal';
import type { ProfileStore } from '@my-pi-harness/storage';
import {
  FilePublicationError,
  hashFileBytes,
  publishWorkspaceFile,
  readWorkspaceFileSnapshot,
  sameFileImage,
  sameFilesystemIdentity,
  type FileImage,
  type WorkspaceContext,
  type WorkspaceFileSnapshot,
} from '@my-pi-harness/sandbox';
import {
  MAXIMUM_FILE_CHANGE_BYTES,
  ToolError,
  type FileChangeInvocation,
  type FileModification,
  type ToolResult,
} from '@my-pi-harness/tools';
import { FileChangeError } from './errors';
import { fileRequestHash, fileTargetKey, matchesFileImage } from './images';
import { FileWriteGate } from './write-gate';

export interface FileChangeOwner {
  sessionId: string;
  runId: string;
  branchId: string;
  workspaceId: string | null;
  readOnly: boolean;
}
export interface FileChangeServiceOptions {
  store: ProfileStore;
  workspaces: { requireAvailable(id: string): Promise<Workspace> };
  profileDirectory: string;
}
interface Publication {
  sessionId: string;
  runId: string | null;
  intent: Omit<
    FileOperationPrepare,
    | 'before'
    | 'after'
    | 'targetKey'
    | 'rootIdentity'
    | 'parentIdentity'
    | 'expectedRevision'
    | 'requestHash'
  >;
  context: WorkspaceContext;
  before: WorkspaceFileSnapshot;
  after: FileImage;
  beforePublish(operationId: string): void;
  confirmNotPublished(): void;
  afterPrepare?(): void;
}

/** Owns native write ordering, immutable preimages and settlement across the filesystem and journal. */
export class FileChangeService {
  public readonly gate = new FileWriteGate();
  public constructor(private readonly options: FileChangeServiceOptions) {}

  public stopAccepting(): void {
    this.gate.stopAccepting();
  }

  public close(): Promise<void> {
    return this.gate.close();
  }

  /** The native tool's content semantics execute inside the same gate as the checked publication. */
  public modify(
    owner: FileChangeOwner,
    input: FileModification,
    invocation: FileChangeInvocation,
  ): Promise<ToolResult> {
    return this.gate.run(invocation.signal, async (signal) => {
      if (owner.readOnly) throw new ToolError('READ_ONLY', '当前运行仅允许只读操作。');
      if (owner.workspaceId === null)
        throw new ToolError('WORKSPACE_REQUIRED', '文件修改需要工作区。');
      this.requireWorkspaceOwner(owner.sessionId, owner.workspaceId);
      const context = await this.context(owner.workspaceId, signal);
      const before = await readWorkspaceFileSnapshot(
        context,
        input.path,
        MAXIMUM_FILE_CHANGE_BYTES,
      );
      const actualHash = before.image.bytes === null ? null : hashFileBytes(before.image.bytes);
      if (actualHash !== input.expectedHash)
        throw new ToolError('PREIMAGE_MISMATCH', '文件已变化，请重新读取后再修改。');
      const prepared = input.prepare(
        before.image.bytes === null ? null : Uint8Array.from(before.image.bytes),
      );
      if (prepared.content.byteLength > MAXIMUM_FILE_CHANGE_BYTES)
        throw new ToolError('FILE_TOO_LARGE', '修改后的文件超过大小限制。');
      const after: FileImage = {
        bytes: Uint8Array.from(prepared.content),
        mode: before.image.mode ?? 0o600,
      };
      if (sameFileImage(before.image, after)) return prepared.result;
      const operationId = randomUUID();
      await this.publish({
        sessionId: owner.sessionId,
        runId: owner.runId,
        intent: {
          operationId,
          action: 'write',
          targetChangeId: null,
          workspaceId: owner.workspaceId,
          path: before.relativePath,
          branchId: owner.branchId,
          source: { kind: 'tool', toolCallId: invocation.toolCallId },
        },
        context,
        before,
        after,
        beforePublish: invocation.beforePublish,
        confirmNotPublished: invocation.confirmNotPublished,
      });
      return prepared.result;
    });
  }

  public async context(workspaceId: string, signal: AbortSignal): Promise<WorkspaceContext> {
    const workspace = await this.options.workspaces.requireAvailable(workspaceId);
    signal.throwIfAborted();
    return {
      workspaceRoot: workspace.rootPath,
      profileDirectory: this.options.profileDirectory,
      signal,
    };
  }

  /** Preflight and each individual publication use these same head, identity and byte checks. */
  public async check(
    record: FileChangeRecord,
    action: 'undo' | 'redo',
    signal: AbortSignal,
  ): Promise<WorkspaceFileSnapshot> {
    const original = record.operation.intent;
    if (!record.local || record.operation.status !== 'applied')
      throw new FileChangeError('FILE_CHANGE_CONFLICT', '此历史变更不具备本机撤销资格。');
    this.requireWorkspaceOwner(record.operation.sessionId, original.workspaceId);
    const context = await this.context(original.workspaceId, signal);
    const snapshot = await readWorkspaceFileSnapshot(
      context,
      original.path,
      MAXIMUM_FILE_CHANGE_BYTES,
    );
    if (
      !sameFilesystemIdentity(snapshot.rootIdentity, original.rootIdentity) ||
      !sameFilesystemIdentity(snapshot.parentIdentity, original.parentIdentity) ||
      fileTargetKey(snapshot) !== original.targetKey
    )
      throw new FileChangeError('FILE_CHANGE_CONFLICT', '工作区或父目录已改变，不能覆盖当前文件。');
    if (!matchesFileImage(snapshot.image, action === 'undo' ? original.after : original.before))
      throw new FileChangeError('FILE_CHANGE_CONFLICT', '文件内容或权限已变化，请先核对外部修改。');
    return snapshot;
  }

  /** Called only by the batch owner while it holds the profile gate. */
  public async restore(
    sessionId: string,
    changeId: string,
    action: 'undo' | 'redo',
    operationId: string,
    signal: AbortSignal,
    afterPrepare: () => void,
  ): Promise<FileOperationRecord> {
    const record = this.options.store.getFileChangeRecord(sessionId, changeId);
    const original = record.operation.intent;
    const head = this.options.store.getFileChangeHead(original.targetKey);
    const eligible =
      action === 'undo'
        ? record.applied && head.headChangeId === changeId
        : !record.applied &&
          head.redoTopChangeId === changeId &&
          head.redoEpoch === record.redoEpoch;
    if (!eligible || head.pendingOperationId !== null || head.uncertainOperationId !== null)
      throw new FileChangeError('FILE_CHANGE_CONFLICT', '文件变更顺序已改变，请刷新后重新选择。');
    const before = await this.check(record, action, signal);
    const target = action === 'undo' ? original.before : original.after;
    const after: FileImage = target.exists
      ? { bytes: this.options.store.readFileChangeBytes(target), mode: target.mode }
      : { bytes: null, mode: null };
    return await this.publish({
      sessionId,
      runId: null,
      intent: {
        operationId,
        action,
        targetChangeId: changeId,
        workspaceId: original.workspaceId,
        path: original.path,
        branchId: original.branchId,
        source: { kind: 'user' },
      },
      context: await this.context(original.workspaceId, signal),
      before,
      after,
      beforePublish: () => undefined,
      confirmNotPublished: () => undefined,
      afterPrepare,
    });
  }

  private requireWorkspaceOwner(sessionId: string, workspaceId: string): void {
    if (this.options.store.getSession(sessionId)?.workspaceId !== workspaceId)
      throw new FileChangeError(
        'FILE_CHANGE_CONFLICT',
        '会话的工作区已改变，不能执行历史文件操作。',
      );
  }

  private async publish(input: Publication): Promise<FileOperationRecord> {
    const { store } = this.options;
    const pins: string[] = [];
    const freeze = (image: FileImage): FileChangeImage => {
      if (image.bytes === null) return { exists: false };
      const blob = store.putFileChangeBytes(image.bytes);
      pins.push(blob.sha256);
      return { exists: true, ...blob, mode: image.mode };
    };
    try {
      const before = freeze(input.before.image);
      const after = freeze(input.after);
      const targetKey = fileTargetKey(input.before);
      const head = store.getFileChangeHead(targetKey);
      const intent: FileOperationPrepare = {
        ...input.intent,
        before,
        after,
        targetKey,
        rootIdentity: input.before.rootIdentity,
        parentIdentity: input.before.parentIdentity,
        expectedRevision: head.revision,
        requestHash: fileRequestHash([input.intent, before, after, targetKey, head.revision]),
      };
      input.context.signal.throwIfAborted();
      store.prepareFileOperation(input.sessionId, intent, input.runId, Date.now());
      input.afterPrepare?.();
      try {
        await publishWorkspaceFile(input.context, input.before, input.after, () =>
          input.beforePublish(intent.operationId),
        );
      } catch (error) {
        if (!(error instanceof FilePublicationError)) throw error;
        const notPublished = error.publication === 'not-published';
        if (notPublished) input.confirmNotPublished();
        store.completeFileOperation(
          input.sessionId,
          intent.operationId,
          {
            status: notPublished ? 'not_applied' : 'unknown',
            error: notPublished
              ? '写入在文件发布前停止，文件未由本次操作修改。'
              : '文件操作可能已生效，请核对当前文件。',
          },
          Date.now(),
        );
        throw error;
      }
      return store.completeFileOperation(
        input.sessionId,
        intent.operationId,
        { status: 'applied', error: null },
        Date.now(),
      );
    } finally {
      for (const hash of pins) store.abandonFileChangeBytes(hash);
    }
  }
}
