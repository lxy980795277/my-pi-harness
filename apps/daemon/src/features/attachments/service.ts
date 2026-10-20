import { randomUUID } from 'node:crypto';
import { opendir } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import {
  ExecutionError,
  extractPdf,
  extractDocument,
  isPortableFileName,
  isSensitiveName,
  openRegular,
  toWorkspaceRelativePath,
  workspacePath,
} from '@my-pi-harness/execution';
import type {
  Attachment,
  AttachmentContent,
  AttachmentReference,
  AttachmentUpload,
  Workspace,
} from '@my-pi-harness/protocol';
import type { ProfileStore } from '@my-pi-harness/storage';
import {
  checkAborted,
  decodeText,
  documentFormat,
  decodeUpload,
  imageMediaType,
  safeName,
  IMAGE_LIMIT,
  PDF_LIMIT,
} from './content.js';

type AttachmentStore = Pick<ProfileStore, 'putAttachment' | 'getAttachment'>;
type Workspaces = { requireAvailable(id: string): Promise<Workspace> };

/** Freezes bounded user-selected content; model context reads these records without reopening files. */
export class AttachmentService {
  private readonly active = new Map<AbortController, Promise<unknown>>();
  private closing = false;

  private async perform<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.closing) throw new RuntimeError('ATTACHMENTS_CLOSED', '附件服务已关闭。');
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const task = operation(combined);
    this.active.set(controller, task);
    try {
      return await task;
    } finally {
      this.active.delete(controller);
    }
  }

  /** Reject new work, cancel parsing and wait until every owned operation releases resources. */
  public async close(): Promise<void> {
    this.closing = true;
    for (const controller of this.active.keys()) controller.abort();
    await Promise.allSettled(this.active.values());
  }

  public constructor(
    private readonly store: AttachmentStore,
    private readonly workspaces: Workspaces,
    private readonly profileDirectory: string,
  ) {}

  public get(id: string): AttachmentContent {
    const content = this.store.getAttachment(id);
    if (!content) throw new RuntimeError('ATTACHMENT_NOT_FOUND', '附件不存在。');
    return content;
  }

  private async freeze(
    name: string,
    mediaType: string,
    bytes: Buffer,
    sourcePath: string | null,
    signal: AbortSignal,
    range?: { startLine?: number; endLine?: number },
    workspaceId: string | null = null,
  ): Promise<Attachment> {
    checkAborted(signal);
    const imageType = imageMediaType(bytes);
    const format = documentFormat(name, mediaType);
    let kind: Attachment['kind'] = 'text';
    let text: string | null = null;
    let imageData: string | null = null;

    if (format) {
      if (bytes.length > PDF_LIMIT)
        throw new RuntimeError('ATTACHMENT_TOO_LARGE', '文档不能超过8MiB。');
      if (format === 'rtf') {
        if (!bytes.subarray(0, 5).equals(Buffer.from('{\\rtf')))
          throw new RuntimeError('ATTACHMENT_TYPE', 'RTF文档内容无效。');
      } else if (bytes[0] !== 80 || bytes[1] !== 75) {
        throw new RuntimeError('ATTACHMENT_TYPE', '文档内容无效。');
      }
      kind = 'document';
      text = await extractDocument(bytes, format, signal);
    } else if (mediaType.startsWith('image/')) {
      if (bytes.length > IMAGE_LIMIT)
        throw new RuntimeError('ATTACHMENT_TOO_LARGE', '图片不能超过2MiB。');
      if (imageType !== mediaType)
        throw new RuntimeError('ATTACHMENT_TYPE', '图片类型与内容不符。');
      kind = 'image';
      imageData = bytes.toString('base64');
    } else if (mediaType === 'application/pdf') {
      if (bytes.length > PDF_LIMIT)
        throw new RuntimeError('ATTACHMENT_TOO_LARGE', 'PDF不能超过8MiB。');
      if (bytes.subarray(0, 5).toString() !== '%PDF-')
        throw new RuntimeError('ATTACHMENT_TYPE', 'PDF内容无效。');
      kind = 'pdf';
      text = await extractPdf(bytes, signal);
    } else if (
      mediaType.startsWith('text/') ||
      [
        'application/json',
        'application/xml',
        'application/javascript',
        'application/x-yaml',
      ].includes(mediaType)
    ) {
      text = decodeText(bytes);
    } else throw new RuntimeError('ATTACHMENT_TYPE', '不支持此附件格式。');
    if (range && text === null)
      throw new RuntimeError('ATTACHMENT_RANGE', '只有文本文件支持行范围。');
    if (range && text !== null) {
      const lines = text.split('\n');
      const start = range.startLine ?? 1;
      const end = range.endLine ?? lines.length;
      if (start > end || start > lines.length || end > lines.length)
        throw new RuntimeError('ATTACHMENT_RANGE', '引用的行范围无效。');
      text = lines.slice(start - 1, end).join('\n');
    }
    if (sourcePath !== null && kind === 'text') kind = 'reference';
    checkAborted(signal);
    const attachment: Attachment = {
      id: randomUUID(),
      name: safeName(name),
      mediaType,
      kind,
      byteLength: bytes.length,
      preview: (text ?? '').slice(0, 4000),
      sourcePath,
      workspaceId,
      createdAt: Date.now(),
    };
    this.store.putAttachment({ attachment, text, imageData });
    return attachment;
  }

  public async upload(input: AttachmentUpload, signal?: AbortSignal): Promise<Attachment> {
    return await this.perform(async (ownedSignal) => {
      safeName(input.name);
      return await this.freeze(
        input.name,
        input.mediaType,
        decodeUpload(input.data),
        null,
        ownedSignal,
      );
    }, signal);
  }

  public async reference(input: AttachmentReference, signal?: AbortSignal): Promise<Attachment> {
    return await this.perform(
      async (ownedSignal) => await this.referenceContent(input, ownedSignal),
      signal,
    );
  }

  private async referenceContent(
    input: AttachmentReference,
    signal: AbortSignal,
  ): Promise<Attachment> {
    const workspace = await this.workspaces.requireAvailable(input.workspaceId);
    checkAborted(signal);
    try {
      const path = await workspacePath(workspace.rootPath, input.path);
      const profile = resolve(this.profileDirectory);
      const difference = relative(profile, path);
      if (
        difference === '' ||
        (!isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${sep}`))
      )
        throw new RuntimeError('ATTACHMENT_PATH', '不能引用应用数据目录。');
      const handle = await openRegular(path, PDF_LIMIT);
      let bytes: Buffer;
      try {
        const before = await handle.stat();
        bytes = Buffer.alloc(Math.min(before.size + 1, PDF_LIMIT + 1));
        let length = 0;
        while (length < bytes.length) {
          checkAborted(signal);
          const result = await handle.read(bytes, length, bytes.length - length, length);
          if (result.bytesRead === 0) break;
          length += result.bytesRead;
        }
        bytes = bytes.subarray(0, length);
        const after = await handle.stat();
        if (
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          length !== before.size
        )
          throw new RuntimeError('ATTACHMENT_CHANGED', '引用文件在读取期间发生改变。');
      } finally {
        await handle.close();
      }
      let mediaType = imageMediaType(bytes);
      if (mediaType === undefined) {
        mediaType = 'text/plain';
        if (bytes.subarray(0, 5).toString() === '%PDF-') mediaType = 'application/pdf';
      }
      const hasRange = input.startLine !== undefined || input.endLine !== undefined;
      return await this.freeze(
        basename(path),
        mediaType,
        bytes,
        toWorkspaceRelativePath(workspace.rootPath, path),
        signal,
        hasRange ? input : undefined,
        input.workspaceId,
      );
    } catch (cause) {
      if (cause instanceof RuntimeError) throw cause;
      if (cause instanceof ExecutionError)
        throw new RuntimeError('ATTACHMENT_PATH', cause.message, { cause });
      throw new RuntimeError('ATTACHMENT_PATH', '无法读取工作区引用文件。', { cause });
    }
  }

  /** Browse a single safe directory, at most 500 entries; directories end in slash. */
  public async listFiles(workspaceId: string, path = '.'): Promise<string[]> {
    const workspace = await this.workspaces.requireAvailable(workspaceId);
    const actual = await workspacePath(workspace.rootPath, path);
    const entries: string[] = [];
    const directory = await opendir(actual);
    let visited = 0;
    for await (const entry of directory) {
      visited += 1;
      if (visited > 5000 || entries.length >= 500) break;
      if (entry.isSymbolicLink() || isSensitiveName(entry.name) || !isPortableFileName(entry.name))
        continue;
      if (!entry.isDirectory() && !entry.isFile()) continue;
      entries.push(
        `${toWorkspaceRelativePath(workspace.rootPath, resolve(actual, entry.name))}${entry.isDirectory() ? '/' : ''}`,
      );
    }
    return entries.sort((left, right) => left.localeCompare(right));
  }
}
