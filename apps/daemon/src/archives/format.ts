import {
  closeSync,
  constants,
  createReadStream,
  createWriteStream,
  openSync,
  type WriteStream,
} from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { extract, pack } from 'tar-stream';
import { Value } from 'typebox/value';
import { SessionArchiveManifestSchema, type SessionArchiveManifest } from '@my-pi-harness/protocol';
import { ArchiveByteStream } from './byte-stream';
import { ArchiveError } from './errors';
import { ARCHIVE_LIMITS } from './limits';

export interface ArchiveEntrySource {
  path: string;
  bytes: number;
  sha256: string;
  open(): Readable;
}
export interface ArchivePackSource {
  manifest: SessionArchiveManifest;
  entries: readonly ArchiveEntrySource[];
}
export interface ExtractedArchive {
  manifest: SessionArchiveManifest;
  archiveSha256: string;
  bytes: number;
  open(path: string): Readable;
}

function safeName(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 4096 &&
    !/[\\\u0000-\u001f\u007f:]/.test(path) &&
    !path.startsWith('/') &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

function archiveFile(path: string): WriteStream {
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    return createWriteStream(path, { fd, autoClose: true, flush: true });
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

/** Compression contains only declared regular files; archive paths never become filesystem paths. */
export async function writeArchive(
  source: ArchivePackSource,
  path: string,
  signal: AbortSignal,
  progress: (bytes: number) => void,
): Promise<{ bytes: number; sha256: string }> {
  const manifest = Buffer.from(JSON.stringify(source.manifest));
  if (
    manifest.byteLength > ARCHIVE_LIMITS.manifestBytes ||
    source.entries.length > ARCHIVE_LIMITS.entries
  )
    throw new ArchiveError('ARCHIVE_SIZE_LIMIT', '归档清单或资源数量超过限制。');
  const writer = archiveFile(path);
  const archive = pack();
  const compressed = new ArchiveByteStream({ maximum: ARCHIVE_LIMITS.compressedBytes, progress });
  const expanded = new ArchiveByteStream({ maximum: ARCHIVE_LIMITS.expandedBytes });
  const consume = pipeline(archive, expanded, createGzip(), compressed, writer, { signal });
  const produce = (async () => {
    const first = archive.entry({
      name: 'manifest.json',
      size: manifest.byteLength,
      mode: 0o600,
      mtime: new Date(0),
    });
    await pipeline(Readable.from([manifest]), first, { signal });
    const seen = new Set(['manifest.json']);
    for (const entry of source.entries) {
      signal.throwIfAborted();
      if (!safeName(entry.path) || seen.has(entry.path))
        throw new ArchiveError('ARCHIVE_PATH', '归档条目名称重复或不受支持。');
      seen.add(entry.path);
      const maximum = entry.path.endsWith('.jsonl')
        ? ARCHIVE_LIMITS.journalBytes
        : ARCHIVE_LIMITS.resourceBytes;
      if (entry.bytes > maximum)
        throw new ArchiveError('ARCHIVE_SIZE_LIMIT', '归档单个资源超过大小限制。');
      const verify = new ArchiveByteStream({
        maximum,
        expectedBytes: entry.bytes,
        expectedHash: entry.sha256,
      });
      await pipeline(
        entry.open(),
        verify,
        archive.entry({ name: entry.path, size: entry.bytes, mode: 0o600, mtime: new Date(0) }),
        { signal },
      );
    }
    archive.finalize();
  })();
  try {
    await Promise.all([consume, produce]);
    return { bytes: compressed.bytes, sha256: compressed.sha256() };
  } catch (cause) {
    archive.destroy(cause instanceof Error ? cause : new Error('Archive transfer failed'));
    await Promise.allSettled([consume, produce]);
    throw cause;
  }
}

/** Parse tar entries into opaque owned files, rejecting links, extra entries and undeclared bytes. */
export async function readArchive(
  input: Readable,
  directory: string,
  signal: AbortSignal,
  progress: (bytes: number) => void,
): Promise<ExtractedArchive> {
  const parser = extract();
  const compressed = new ArchiveByteStream({ maximum: ARCHIVE_LIMITS.compressedBytes, progress });
  const expanded = new ArchiveByteStream({ maximum: ARCHIVE_LIMITS.expandedBytes });
  const physical = new Map<string, string>();
  const declared = new Map<string, SessionArchiveManifest['entries'][number]>();
  let manifest: SessionArchiveManifest | undefined;
  const feed = pipeline(input, compressed, createGunzip(), expanded, parser, { signal });
  const parse = (async () => {
    let index = 0;
    for await (const entry of parser) {
      const header = entry.header;
      if (
        header.type !== 'file' ||
        header.linkname ||
        !safeName(header.name) ||
        !Number.isSafeInteger(header.size) ||
        header.size < 0
      )
        throw new ArchiveError(
          'ARCHIVE_PATH',
          '归档只允许名称明确的普通文件，不允许链接或特殊条目。',
        );
      if (index === 0) {
        if (header.name !== 'manifest.json' || header.size > ARCHIVE_LIMITS.manifestBytes)
          throw new ArchiveError('ARCHIVE_MANIFEST', '归档缺少有效的首项清单。');
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of entry) {
          const part: unknown = chunk;
          if (!Buffer.isBuffer(part))
            throw new ArchiveError('ARCHIVE_MANIFEST', '归档清单内容类型无效。');
          length += part.byteLength;
          if (length > ARCHIVE_LIMITS.manifestBytes)
            throw new ArchiveError('ARCHIVE_SIZE_LIMIT', '归档清单超过大小限制。');
          chunks.push(part);
        }
        if (length !== header.size)
          throw new ArchiveError('ARCHIVE_MANIFEST', '归档清单长度不符。');
        let value: unknown;
        try {
          value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (cause) {
          throw new ArchiveError('ARCHIVE_MANIFEST', '归档清单不是有效JSON。', 400, { cause });
        }
        if (
          !Value.Check(SessionArchiveManifestSchema, value) ||
          value.entries.length > ARCHIVE_LIMITS.entries
        )
          throw new ArchiveError('ARCHIVE_MANIFEST', '归档格式版本或清单字段不受支持。');
        const names = new Set<string>();
        let bytes = 0;
        for (const item of value.entries) {
          const limit =
            item.kind === 'journal' ? ARCHIVE_LIMITS.journalBytes : ARCHIVE_LIMITS.resourceBytes;
          if (
            !safeName(item.path) ||
            item.path === 'manifest.json' ||
            names.has(item.path) ||
            item.bytes > limit
          )
            throw new ArchiveError('ARCHIVE_MANIFEST', '归档清单包含重复、越界或不受支持的资源。');
          names.add(item.path);
          declared.set(item.path, item);
          bytes += item.bytes;
        }
        if (bytes > ARCHIVE_LIMITS.expandedBytes)
          throw new ArchiveError('ARCHIVE_SIZE_LIMIT', '归档展开内容超过大小限制。');
        manifest = value;
      } else {
        if (manifest === undefined) throw new ArchiveError('ARCHIVE_MANIFEST', '归档清单不可用。');
        const expected = declared.get(header.name);
        if (expected === undefined || physical.has(header.name) || header.size !== expected.bytes)
          throw new ArchiveError('ARCHIVE_ENTRY', '归档出现未声明、重复或长度不符的条目。');
        const path = join(directory, `entry-${index}`);
        const maximum =
          expected.kind === 'journal' ? ARCHIVE_LIMITS.journalBytes : ARCHIVE_LIMITS.resourceBytes;
        const verify = new ArchiveByteStream({
          maximum,
          expectedBytes: expected.bytes,
          expectedHash: expected.sha256,
        });
        await pipeline(entry, verify, archiveFile(path), { signal });
        physical.set(header.name, path);
      }
      if (++index > ARCHIVE_LIMITS.entries + 1)
        throw new ArchiveError('ARCHIVE_SIZE_LIMIT', '归档资源数量超过限制。');
    }
  })();
  try {
    await Promise.all([feed, parse]);
  } catch (cause) {
    parser.destroy(cause instanceof Error ? cause : new Error('Archive parsing failed'));
    await Promise.allSettled([feed, parse]);
    if (cause instanceof ArchiveError || signal.aborted) throw cause;
    throw new ArchiveError('ARCHIVE_INVALID', '归档压缩流或文件结构无效。', 400, { cause });
  }
  if (manifest === undefined || physical.size !== manifest.entries.length)
    throw new ArchiveError('ARCHIVE_MISSING_RESOURCE', '归档缺少清单中声明的资源。');
  return {
    manifest,
    archiveSha256: compressed.sha256(),
    bytes: compressed.bytes,
    open(path) {
      const file = physical.get(path);
      if (file === undefined)
        throw new ArchiveError('ARCHIVE_MISSING_RESOURCE', '归档资源不可用。');
      return createReadStream(file, {
        fd: openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW),
        autoClose: true,
      });
    },
  };
}
