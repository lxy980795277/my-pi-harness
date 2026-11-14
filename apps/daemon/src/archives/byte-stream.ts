import { createHash } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { ArchiveError } from './errors';

export interface ArchiveByteCheck {
  maximum: number;
  expectedBytes?: number;
  expectedHash?: string;
  progress?(bytes: number): void;
}

/** Bounded streaming validation does not retain transferred bodies in memory. */
export class ArchiveByteStream extends Transform {
  public bytes = 0;
  private readonly hash = createHash('sha256');
  private digest: string | undefined;
  public constructor(private readonly options: ArchiveByteCheck) {
    super();
  }

  public override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.bytes += chunk.byteLength;
    if (
      this.bytes > this.options.maximum ||
      (this.options.expectedBytes !== undefined && this.bytes > this.options.expectedBytes)
    ) {
      callback(new ArchiveError('ARCHIVE_SIZE_LIMIT', '归档内容超过大小限制。'));
      return;
    }
    this.hash.update(chunk);
    this.options.progress?.(this.bytes);
    callback(null, chunk);
  }

  public override _flush(callback: TransformCallback): void {
    this.digest = this.hash.digest('hex');
    if (
      (this.options.expectedBytes !== undefined && this.bytes !== this.options.expectedBytes) ||
      (this.options.expectedHash !== undefined && this.digest !== this.options.expectedHash)
    ) {
      callback(new ArchiveError('ARCHIVE_CHECKSUM', '归档条目的长度或校验值不符。'));
      return;
    }
    callback();
  }

  public sha256(): string {
    if (this.digest === undefined)
      throw new ArchiveError('ARCHIVE_INCOMPLETE', '归档传输尚未完成。', 409);
    return this.digest;
  }
}
