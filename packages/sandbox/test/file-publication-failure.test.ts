import { constants } from 'node:fs';
import type * as FsPromises from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { publishWorkspaceFile, readWorkspaceFileSnapshot } from '../src/index';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>();
  return {
    ...original,
    open: async (path: string, flags: number, mode?: number): Promise<FileHandle> => {
      const handle = await original.open(path, flags, mode);
      if ((flags & constants.O_DIRECTORY) !== 0)
        vi.spyOn(handle, 'sync').mockRejectedValueOnce(
          new Error('Injected directory sync failure'),
        );
      return handle;
    },
  };
});

describe('file publication settlement', () => {
  it.skipIf(process.platform === 'win32')(
    'reports an unknown result after a real target publication followed by a sync failure',
    async () => {
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-publication-sync-')));
      const workspaceRoot = join(directory, 'workspace');
      const profileDirectory = join(directory, 'profile');
      await mkdir(workspaceRoot);
      await mkdir(profileDirectory);
      const context = { workspaceRoot, profileDirectory, signal: new AbortController().signal };
      try {
        const before = await readWorkspaceFileSnapshot(context, 'published.txt', 100);
        const barrier = vi.fn();
        await expect(
          publishWorkspaceFile(
            context,
            before,
            { bytes: Buffer.from('real effect'), mode: 0o600 },
            barrier,
          ),
        ).rejects.toMatchObject({ publication: 'unknown' });
        expect(barrier).toHaveBeenCalledTimes(1);
        expect(await readFile(join(workspaceRoot, 'published.txt'), 'utf8')).toBe('real effect');
        expect(await readdir(workspaceRoot)).toEqual(['published.txt']);
      } finally {
        vi.restoreAllMocks();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
