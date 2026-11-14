import { readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  publishWorkspaceFile,
  readWorkspaceFileSnapshot,
  type WorkspaceContext,
} from '../src/index';

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-file-publication-')));
  directories.push(directory);
  const workspaceRoot = join(directory, 'workspace');
  const profileDirectory = join(directory, 'profile');
  await mkdir(workspaceRoot);
  await mkdir(profileDirectory);
  const controller = new AbortController();
  const context: WorkspaceContext = { workspaceRoot, profileDirectory, signal: controller.signal };
  const path = join(workspaceRoot, 'sample.txt');
  return { directory, workspaceRoot, path, context, controller };
}

describe('checked workspace byte publication', () => {
  it('creates, replaces and deletes through a barrier that still sees the old bytes', async () => {
    const f = await fixture();
    const absent = await readWorkspaceFileSnapshot(f.context, 'sample.txt', 100);
    const beforeCreate = vi.fn(() => expect(() => readFileSync(f.path)).toThrow());
    await publishWorkspaceFile(
      f.context,
      absent,
      { bytes: Buffer.from('first\r\n'), mode: 0o640 },
      beforeCreate,
    );
    expect(beforeCreate).toHaveBeenCalledTimes(1);
    expect(await readFile(f.path)).toEqual(Buffer.from('first\r\n'));
    const first = await readWorkspaceFileSnapshot(f.context, 'sample.txt', 100);
    expect(first.image.mode).toBe(process.platform === 'win32' ? 0o666 : 0o640);
    const replacement = Buffer.from('\uFEFFsecond\r\n');
    await publishWorkspaceFile(
      f.context,
      first,
      { bytes: replacement, mode: first.image.mode ?? 0o600 },
      () => {
        expect(readFileSync(f.path)).toEqual(Buffer.from('first\r\n'));
      },
    );
    expect(await readFile(f.path)).toEqual(replacement);
    const second = await readWorkspaceFileSnapshot(f.context, 'sample.txt', 100);
    await publishWorkspaceFile(f.context, second, { bytes: null, mode: null }, () => {
      expect(readFileSync(f.path)).toEqual(replacement);
    });
    await expect(stat(f.path)).rejects.toHaveProperty('code', 'ENOENT');
    expect(await readdir(f.workspaceRoot)).toEqual([]);
  });

  it('does not dispatch an unchanged image and restores exact supported mode bits', async () => {
    const f = await fixture();
    await writeFile(f.path, 'same');
    await chmod(f.path, 0o600);
    const before = await readWorkspaceFileSnapshot(f.context, 'sample.txt', 100);
    const barrier = vi.fn();
    await publishWorkspaceFile(f.context, before, before.image, barrier);
    expect(barrier).not.toHaveBeenCalled();
    if (process.platform !== 'win32') {
      await publishWorkspaceFile(
        f.context,
        before,
        { bytes: Buffer.from('next'), mode: 0o666 },
        barrier,
      );
      expect((await stat(f.path)).mode & 0o777).toBe(0o666);
      expect(barrier).toHaveBeenCalledTimes(1);
    }
    expect(await readdir(f.workspaceRoot)).toEqual(['sample.txt']);
  });

  it.each(['content', 'mode', 'identity'] as const)(
    'rejects a stale %s before the host barrier',
    async (change) => {
      const f = await fixture();
      await writeFile(f.path, 'before');
      await chmod(f.path, 0o600);
      const before = await readWorkspaceFileSnapshot(f.context, 'sample.txt', 100);
      if (change === 'content') await writeFile(f.path, 'external');
      else if (change === 'mode') await chmod(f.path, 0o644);
      else {
        await rename(f.path, join(f.workspaceRoot, 'original'));
        await writeFile(f.path, 'before');
        await chmod(f.path, 0o600);
      }
      const barrier = vi.fn();
      await expect(
        publishWorkspaceFile(
          f.context,
          before,
          { bytes: Buffer.from('next'), mode: 0o600 },
          barrier,
        ),
      ).rejects.toMatchObject({ publication: 'not-published', code: 'PREIMAGE_MISMATCH' });
      expect(barrier).not.toHaveBeenCalled();
      expect(await readFile(f.path, 'utf8')).toBe(change === 'content' ? 'external' : 'before');
    },
  );

  it.each(['root', 'parent'] as const)(
    'rejects a replaced %s directory even when its filename and bytes match',
    async (change) => {
      const f = await fixture();
      await mkdir(join(f.workspaceRoot, 'nested'));
      const path = join(f.workspaceRoot, 'nested/sample');
      await writeFile(path, 'before');
      const before = await readWorkspaceFileSnapshot(f.context, 'nested/sample', 100);
      const original = change === 'root' ? f.workspaceRoot : join(f.workspaceRoot, 'nested');
      await rename(original, `${original}-old`);
      await mkdir(original);
      if (change === 'root') await mkdir(join(original, 'nested'));
      await writeFile(path, 'before');
      const barrier = vi.fn();
      await expect(
        publishWorkspaceFile(
          f.context,
          before,
          { bytes: Buffer.from('next'), mode: 0o600 },
          barrier,
        ),
      ).rejects.toMatchObject({ publication: 'not-published', code: 'FILE_CHANGED' });
      expect(barrier).not.toHaveBeenCalled();
      expect(await readFile(path, 'utf8')).toBe('before');
    },
  );

  it('cleans the staged bytes when persistence refuses or cancellation reaches the barrier', async () => {
    const f = await fixture();
    await writeFile(f.path, 'before');
    const before = await readWorkspaceFileSnapshot(f.context, 'sample.txt', 100);
    const next = { bytes: Buffer.from('next'), mode: 0o600 };
    await expect(
      publishWorkspaceFile(f.context, before, next, () => {
        throw new Error('Durable preparation refused');
      }),
    ).rejects.toMatchObject({ publication: 'not-published' });
    await expect(
      publishWorkspaceFile(f.context, before, next, () => f.controller.abort()),
    ).rejects.toMatchObject({ publication: 'not-published', code: 'CANCELLED' });
    expect(await readFile(f.path, 'utf8')).toBe('before');
    expect(await readdir(f.workspaceRoot)).toEqual(['sample.txt']);
  });

  it('rechecks target bytes and staged identity after the host barrier without deleting a replacement temporary file', async () => {
    const f = await fixture();
    await writeFile(f.path, 'before');
    const before = await readWorkspaceFileSnapshot(f.context, 'sample.txt', 100);
    await expect(
      publishWorkspaceFile(f.context, before, { bytes: Buffer.from('next'), mode: 0o600 }, () => {
        writeFileSync(f.path, 'external');
      }),
    ).rejects.toMatchObject({ publication: 'not-published', code: 'PREIMAGE_MISMATCH' });
    expect(await readFile(f.path, 'utf8')).toBe('external');
    const external = await readWorkspaceFileSnapshot(f.context, 'sample.txt', 100);
    let replaced = '';
    await expect(
      publishWorkspaceFile(f.context, external, { bytes: Buffer.from('next'), mode: 0o600 }, () => {
        // The host callback is an observed race boundary, not a filesystem mutation hook in production.
        const temporary = readdirSync(f.workspaceRoot).find((entry) =>
          entry.startsWith('.my-pi-write-'),
        );
        if (!temporary) throw new Error('Expected staged file');
        replaced = join(f.workspaceRoot, temporary);
        renameSync(replaced, `${replaced}-original`);
        writeFileSync(replaced, 'unowned');
      }),
    ).rejects.toMatchObject({ publication: 'not-published', code: 'FILE_CHANGED' });
    expect(await readFile(replaced, 'utf8')).toBe('unowned');
    expect(await readFile(f.path, 'utf8')).toBe('external');
  });

  it('rejects links, hardlinks, protected paths and oversized bytes before preparing an image', async () => {
    const f = await fixture();
    await writeFile(f.path, 'before');
    await symlink(f.path, join(f.workspaceRoot, 'alias'));
    await link(f.path, join(f.workspaceRoot, 'hard'));
    await expect(readWorkspaceFileSnapshot(f.context, 'alias', 100)).rejects.toHaveProperty(
      'code',
      'SYMLINK_PATH',
    );
    await expect(readWorkspaceFileSnapshot(f.context, 'hard', 100)).rejects.toHaveProperty(
      'code',
      'HARDLINK_FILE',
    );
    await expect(readWorkspaceFileSnapshot(f.context, '.env', 100)).rejects.toHaveProperty(
      'code',
      'PROTECTED_PATH',
    );
    await writeFile(join(f.workspaceRoot, 'large'), '12345');
    await expect(readWorkspaceFileSnapshot(f.context, 'large', 4)).rejects.toHaveProperty(
      'code',
      'FILE_TOO_LARGE',
    );
  });
});
