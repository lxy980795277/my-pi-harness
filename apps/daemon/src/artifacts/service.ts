import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import {
  canonicalWorkspace,
  readStableFile,
  SandboxError,
  toWorkspaceRelativePath,
  workspacePath,
} from '@my-pi-harness/sandbox';
import type { Artifact, Workspace } from '@my-pi-harness/protocol';
import type { ProfileStore } from '@my-pi-harness/storage';

export interface ArtifactPublishInput {
  path: string;
  mediaType?: string;
  producerCommandId?: string;
}
export interface ArtifactInvocation {
  toolCallId: string;
  signal: AbortSignal;
  owner: { sessionId: string; runId: string; taskId: string | null };
  workspaceId: string;
}
const mediaTypes: Readonly<Record<string, string>> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/** Registers stable workspace bytes; runtime commits returned metadata with the successful tool terminal. */
export class ArtifactService {
  private closing = false;
  private readonly active = new Map<AbortController, Promise<Artifact>>();
  public constructor(
    private readonly store: Pick<
      ProfileStore,
      'getSession' | 'putArtifactBytes' | 'abandonArtifactPublication'
    >,
    private readonly workspaces: { requireAvailable(id: string): Promise<Workspace> },
    private readonly profileDirectory: string,
  ) {}

  public async publish(
    input: ArtifactPublishInput,
    invocation: ArtifactInvocation,
  ): Promise<Artifact> {
    if (this.closing) throw new RuntimeError('ARTIFACT_CLOSED', '产物服务已关闭。');
    const controller = new AbortController();
    const signal = AbortSignal.any([invocation.signal, controller.signal]);
    const task = this.freeze(input, { ...invocation, signal });
    this.active.set(controller, task);
    try {
      return await task;
    } finally {
      this.active.delete(controller);
    }
  }

  private async freeze(
    input: ArtifactPublishInput,
    invocation: ArtifactInvocation,
  ): Promise<Artifact> {
    const { signal, owner } = invocation;
    signal.throwIfAborted();
    const session = this.store.getSession(owner.sessionId);
    if (session === undefined || session.workspaceId !== invocation.workspaceId)
      throw new RuntimeError('ARTIFACT_OWNER', '产物工作区不属于当前会话。');
    let snapshot: { sha256: string; bytes: number } | undefined;
    try {
      const workspace = await this.workspaces.requireAvailable(invocation.workspaceId);
      const root = await canonicalWorkspace({
        workspaceRoot: workspace.rootPath,
        profileDirectory: this.profileDirectory,
        signal,
      });
      const path = await workspacePath(root, input.path);
      const bytes = await readStableFile(path, signal, 33_554_432);
      const knownType = mediaTypes[extname(path).toLowerCase()];
      const mediaType = input.mediaType ?? knownType ?? 'application/octet-stream';
      if (
        !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(mediaType) ||
        mediaType.length > 200 ||
        (knownType !== undefined && mediaType !== knownType)
      )
        throw new RuntimeError('ARTIFACT_TYPE', '产物媒体类型与文件扩展名不符。');
      if (
        (mediaType === 'application/pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') ||
        (['.docx', '.xlsx', '.pptx'].includes(extname(path).toLowerCase()) &&
          !bytes.subarray(0, 2).equals(Buffer.from('PK')))
      )
        throw new RuntimeError('ARTIFACT_TYPE', '产物内容与文件类型不符。');
      signal.throwIfAborted();
      if (this.store.getSession(owner.sessionId)?.workspaceId !== invocation.workspaceId)
        throw new RuntimeError('ARTIFACT_OWNER', '产物工作区不属于当前会话。');
      snapshot = this.store.putArtifactBytes(bytes);
      signal.throwIfAborted();
      return {
        id: randomUUID(),
        ...owner,
        toolCallId: invocation.toolCallId,
        workspaceId: invocation.workspaceId,
        sourcePath: toWorkspaceRelativePath(root, path),
        name: basename(path),
        mediaType,
        ...snapshot,
        createdAt: Date.now(),
        ...(input.producerCommandId === undefined
          ? {}
          : { producerCommandId: input.producerCommandId }),
      };
    } catch (cause) {
      if (snapshot !== undefined) this.store.abandonArtifactPublication(snapshot.sha256);
      if (cause instanceof SandboxError)
        throw new RuntimeError('ARTIFACT_PATH', cause.message, { cause });
      throw cause;
    }
  }

  public async close(): Promise<void> {
    this.closing = true;
    for (const controller of this.active.keys()) controller.abort();
    await Promise.allSettled(this.active.values());
  }
}
