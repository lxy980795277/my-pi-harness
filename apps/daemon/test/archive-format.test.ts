import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { pack } from 'tar-stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionArchiveManifest } from '@my-pi-harness/protocol';
import { readArchive, writeArchive } from '../src/archives/format';
import { ArchiveByteStream } from '../src/archives/byte-stream';

const directories: string[] = [];
const digest = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
const journal = Buffer.from('immutable journal bytes\n');
const manifest: SessionArchiveManifest = {
  formatVersion: 1,
  sessionId: 'session',
  title: 'Archive',
  snapshotSeq: 1,
  createdAt: 1,
  activeAtSnapshot: false,
  dependencies: { providers: [], workspace: null, plugins: [] },
  entries: [
    { path: 'journal.jsonl', kind: 'journal', bytes: journal.byteLength, sha256: digest(journal) },
  ],
};

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'my-pi-archive-format-'));
  directories.push(path);
  return path;
}
async function collect(source: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of source) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Expected binary fixture stream');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function tar(
  entries: Array<{ name: string; bytes: Buffer; type?: 'file' | 'symlink'; linkname?: string }>,
): Promise<Buffer> {
  const archive = pack();
  const pending = collect(archive);
  for (const entry of entries)
    archive.entry(
      {
        name: entry.name,
        size: entry.bytes.length,
        ...(entry.type === undefined ? {} : { type: entry.type }),
        ...(entry.linkname === undefined ? {} : { linkname: entry.linkname }),
      },
      entry.bytes,
    );
  archive.finalize();
  return gzipSync(await pending);
}
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('streamed session archive container', () => {
  it('round-trips regular declared entries and verifies the actual compressed digest', async () => {
    const root = await directory();
    const path = join(root, 'archive.tar.gz');
    const packed = await writeArchive(
      {
        manifest,
        entries: [
          {
            ...manifest.entries[0],
            path: 'journal.jsonl',
            bytes: journal.length,
            sha256: digest(journal),
            open: () => Readable.from([journal]),
          },
        ],
      },
      path,
      new AbortController().signal,
      () => undefined,
    );
    const unpacked = await readArchive(
      createReadStream(path),
      root,
      new AbortController().signal,
      () => undefined,
    );
    expect(unpacked.manifest).toEqual(manifest);
    expect(unpacked.archiveSha256).toBe(packed.sha256);
    expect(unpacked.bytes).toBe(packed.bytes);
    expect(await collect(unpacked.open('journal.jsonl'))).toEqual(journal);
  });

  it.each([
    '../escape',
    '/absolute',
    'C:/drive',
    'nested\\file',
    './journal.jsonl',
    'nested//file',
  ])('rejects archive paths %s without creating named targets', async (name) => {
    const root = await directory();
    const bytes = await tar([
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
      { name, bytes: journal },
    ]);
    await expect(
      readArchive(Readable.from([bytes]), root, new AbortController().signal, () => undefined),
    ).rejects.toThrow();
  });

  it('rejects symlinks, duplicates, missing resources, checksum failure and unknown versions', async () => {
    const cases = [
      [
        { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
        {
          name: 'journal.jsonl',
          bytes: Buffer.alloc(0),
          type: 'symlink' as const,
          linkname: '/private/secret',
        },
      ],
      [
        { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
        { name: 'journal.jsonl', bytes: journal },
        { name: 'journal.jsonl', bytes: journal },
      ],
      [{ name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) }],
      [
        { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
        { name: 'journal.jsonl', bytes: Buffer.from('X'.repeat(journal.length)) },
      ],
      [
        {
          name: 'manifest.json',
          bytes: Buffer.from(JSON.stringify({ ...manifest, formatVersion: 2 })),
        },
      ],
    ];
    for (const entries of cases) {
      const root = await directory();
      const bytes = await tar(entries);
      await expect(
        readArchive(Readable.from([bytes]), root, new AbortController().signal, () => undefined),
      ).rejects.toThrow();
    }
  });

  it('rejects oversized declared resources before accepting their payload and enforces streamed byte limits', async () => {
    const root = await directory();
    const oversized = {
      ...manifest,
      entries: [
        {
          ...manifest.entries[0],
          path: 'blob',
          kind: 'blob',
          bytes: 40 * 1024 * 1024,
          sha256: digest(journal),
        },
      ],
    };
    const bytes = await tar([
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(oversized)) },
    ]);
    await expect(
      readArchive(Readable.from([bytes]), root, new AbortController().signal, () => undefined),
    ).rejects.toThrow('越界');
    const checked = new ArchiveByteStream({ maximum: 8 });
    Readable.from([Buffer.alloc(4), Buffer.alloc(5)]).pipe(checked);
    await expect(collect(checked)).rejects.toThrow('限制');
  });

  it('settles cancelled extraction and never accepts an incomplete gzip stream', async () => {
    const root = await directory();
    const controller = new AbortController();
    controller.abort();
    await expect(
      readArchive(
        Readable.from([Buffer.from('invalid')]),
        root,
        controller.signal,
        () => undefined,
      ),
    ).rejects.toThrow();
    const encoded = await tar([
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: 'journal.jsonl', bytes: journal },
    ]);
    await expect(
      readArchive(
        Readable.from([encoded.subarray(0, encoded.length - 6)]),
        root,
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toThrow();
  });
});
