import {
  appendFile,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStableFile } from '../src/filesystem/read-file';
import * as paths from '../src/filesystem/workspace-path';

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { force: true, recursive: true });
});

async function file() {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-stable-file-'));
  directories.push(directory);
  const path = join(directory, 'source.txt');
  await writeFile(path, 'data');
  return { directory, path, signal: new AbortController().signal };
}

describe('stable bounded file bytes', () => {
  it('reads exact bytes at the boundary and rejects existing oversized or non-regular sources', async () => {
    const f = await file();
    expect(await readStableFile(f.path, f.signal, 4)).toEqual(Buffer.from('data'));
    await expect(readStableFile(f.path, f.signal, 3)).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
    await mkdir(join(f.directory, 'folder'));
    await expect(readStableFile(join(f.directory, 'folder'), f.signal, 4)).rejects.toMatchObject({
      code: 'NOT_REGULAR_FILE',
    });
    await symlink(f.path, join(f.directory, 'alias'));
    await expect(readStableFile(join(f.directory, 'alias'), f.signal, 4)).rejects.toMatchObject({
      code: 'NOT_REGULAR_FILE',
    });
  });

  it('rejects growth after opening and closes the actual file handle', async () => {
    const f = await file();
    const handle = await open(f.path, 'r');
    const stat = handle.stat.bind(handle);
    vi.spyOn(paths, 'openRegular').mockResolvedValueOnce(handle);
    vi.spyOn(handle, 'stat').mockImplementationOnce(async () => {
      const before = await stat();
      await appendFile(f.path, 'expanded');
      return before;
    });
    try {
      await expect(readStableFile(f.path, f.signal, 4)).rejects.toMatchObject({
        code: 'FILE_TOO_LARGE',
      });
      await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
    } finally {
      await handle.close();
    }
  });

  it('rejects a same-size modification observed after opening and closes the handle', async () => {
    const f = await file();
    const handle = await open(f.path, 'r');
    const stat = handle.stat.bind(handle);
    vi.spyOn(paths, 'openRegular').mockResolvedValueOnce(handle);
    vi.spyOn(handle, 'stat').mockImplementationOnce(async () => {
      const before = await stat();
      await writeFile(f.path, 'next');
      await utimes(f.path, before.atimeMs / 1000, before.mtimeMs / 1000 + 2);
      return before;
    });
    try {
      await expect(readStableFile(f.path, f.signal, 4)).rejects.toMatchObject({
        code: 'FILE_CHANGED',
      });
      await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
    } finally {
      await handle.close();
    }
  });

  it('rejects source replacement while the opened descriptor still contains stable bytes', async () => {
    const f = await file();
    const handle = await open(f.path, 'r');
    const stat = handle.stat.bind(handle);
    vi.spyOn(paths, 'openRegular').mockResolvedValueOnce(handle);
    vi.spyOn(handle, 'stat').mockImplementationOnce(async () => {
      const before = await stat();
      await rename(f.path, join(f.directory, 'original.txt'));
      await writeFile(f.path, 'next');
      return before;
    });
    await expect(readStableFile(f.path, f.signal, 4)).rejects.toHaveProperty(
      'code',
      'FILE_CHANGED',
    );
    await expect(handle.stat()).rejects.toHaveProperty('code', 'EBADF');
  });

  it('does not open already cancelled work and closes a handle when cancellation happens during reading', async () => {
    const f = await file();
    const controller = new AbortController();
    controller.abort();
    const opener = vi.spyOn(paths, 'openRegular');
    await expect(readStableFile(f.path, controller.signal, 4)).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    expect(opener).not.toHaveBeenCalled();
    const handle = await open(f.path, 'r');
    const stat = handle.stat.bind(handle);
    const during = new AbortController();
    opener.mockResolvedValueOnce(handle);
    vi.spyOn(handle, 'stat').mockImplementationOnce(async () => {
      const before = await stat();
      during.abort();
      return before;
    });
    try {
      await expect(readStableFile(f.path, during.signal, 4)).rejects.toMatchObject({
        code: 'CANCELLED',
      });
      await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
    } finally {
      await handle.close();
    }
  });
});
