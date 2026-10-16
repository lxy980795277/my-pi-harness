import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import { AttachmentContentSchema, type AttachmentContent } from '@my-pi-harness/protocol';
import { StorageError } from './errors.js';
import type { PrivateSessionFiles } from './private-files.js';
import { checked } from './validation.js';

const BlobSchema = Type.Object(
  {
    version: Type.Literal(1),
    checksum: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    content: AttachmentContentSchema,
  },
  { additionalProperties: false },
);
const MAXIMUM_BLOB_BYTES = 4 * 1024 * 1024;
function digest(content: AttachmentContent): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/** Immutable, checksummed attachment content; SQLite stores only its rebuildable metadata. */
export class AttachmentBlobs {
  public constructor(private readonly files: PrivateSessionFiles) {}

  public ids(): string[] {
    return this.files
      .names(this.files.attachmentDirectory)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const id = name.slice(0, -5);
        this.files.validateId(id);
        return id;
      });
  }

  public read(id: string): AttachmentContent | undefined {
    this.files.validateId(id);
    this.files.checkDirectories();
    const path = join(this.files.attachmentDirectory, `${id}.json`);
    let fd: number;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
    try {
      if (this.files.checkFile(fd, path).size > MAXIMUM_BLOB_BYTES)
        throw new StorageError('SESSION_LOG_INVALID', 'Attachment blob exceeds its size limit');
      const input: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(fd)),
      );
      const blob = checked(BlobSchema, input);
      this.files.checkFile(fd, path);
      if (blob.content.attachment.id !== id || digest(blob.content) !== blob.checksum)
        throw new StorageError(
          'SESSION_LOG_INVALID',
          'Attachment blob identity or checksum is invalid',
        );
      return blob.content;
    } catch (cause) {
      if (cause instanceof StorageError && cause.code === 'SESSION_LOG_INVALID') throw cause;
      throw new StorageError('SESSION_LOG_INVALID', 'Attachment blob could not be read safely', {
        cause,
      });
    } finally {
      closeSync(fd);
    }
  }

  /** Publish a complete file with an exclusive link; existing IDs are never overwritten. */
  public put(input: AttachmentContent): void {
    const content = checked(AttachmentContentSchema, input);
    const id = content.attachment.id;
    this.files.validateId(id);
    if (this.read(id) !== undefined)
      throw new StorageError('CONFLICT', 'Attachment already exists');
    const bytes = Buffer.from(
      `${JSON.stringify({ version: 1, checksum: digest(content), content })}\n`,
    );
    if (bytes.length > MAXIMUM_BLOB_BYTES)
      throw new StorageError('INVALID_RECORD', 'Attachment blob is too large');
    const target = join(this.files.attachmentDirectory, `${id}.json`);
    const temporary = join(this.files.attachmentDirectory, `${id}.${randomUUID()}.tmp`);
    this.files.checkDirectories();
    const fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      this.files.checkFile(fd, temporary);
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset);
        if (written === 0)
          throw new StorageError('SESSION_LOG_UNAVAILABLE', 'Attachment write made no progress');
        offset += written;
      }
      fsyncSync(fd);
      this.files.checkFile(fd, temporary);
      linkSync(temporary, target);
    } finally {
      try {
        closeSync(fd);
      } finally {
        unlinkSync(temporary);
      }
    }
    this.files.syncDirectory(this.files.attachmentDirectory);
  }
}
