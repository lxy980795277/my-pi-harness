import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeTool, resolveWorkspaceRoot, type ExecutionContext } from '../src/index.js';
import { hashBytes } from '../src/file-tools.js';
import {
  canonicalWorkspace,
  parseWorkspaceRelativePath,
  toWorkspaceRelativePath,
} from '../src/workspace-path.js';

let directory: string;
let context: ExecutionContext;
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'execution-root-test-')));
  const workspaceRoot = join(directory, 'workspace');
  const profileDirectory = join(directory, 'profile');
  await mkdir(workspaceRoot);
  await mkdir(profileDirectory);
  context = {
    workspaceRoot,
    profileDirectory,
    readOnly: false,
    signal: new AbortController().signal,
  };
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('shared workspace root policy', () => {
  it('registers a directory alias while execution uses the saved canonical identity', async () => {
    const alias = join(directory, 'alias');
    await symlink(context.workspaceRoot, alias, 'dir');
    expect(
      await resolveWorkspaceRoot({ rootPath: alias, profileDirectory: context.profileDirectory }),
    ).toBe(context.workspaceRoot);
    await expect(canonicalWorkspace({ ...context, workspaceRoot: alias })).rejects.toMatchObject({
      code: 'WORKSPACE_CHANGED',
    });
    expect(await canonicalWorkspace(context)).toBe(context.workspaceRoot);
  });

  it('refuses sensitive roots, the home directory, and profile ancestors or descendants', async () => {
    const sensitive = join(directory, '.ssh', 'project');
    const profileChild = join(context.profileDirectory, 'project');
    await mkdir(sensitive, { recursive: true });
    await mkdir(profileChild);
    for (const rootPath of [
      sensitive,
      homedir(),
      directory,
      context.profileDirectory,
      profileChild,
    ]) {
      await expect(
        resolveWorkspaceRoot({ rootPath, profileDirectory: context.profileDirectory }),
      ).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
    }
  });

  it('reports absent, relative and non-directory roots with safe input errors', async () => {
    await writeFile(join(directory, 'file'), 'text');
    for (const rootPath of ['relative', join(directory, 'missing'), join(directory, 'file')]) {
      try {
        await resolveWorkspaceRoot({ rootPath, profileDirectory: context.profileDirectory });
        throw new Error('Expected rejection');
      } catch (error) {
        expect(error).toMatchObject({ code: 'INVALID_WORKSPACE' });
        expect(String(error)).not.toContain(directory);
      }
    }
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'checks actual directory read access',
    async () => {
      await chmod(context.workspaceRoot, 0);
      try {
        await expect(
          resolveWorkspaceRoot({
            rootPath: context.workspaceRoot,
            profileDirectory: context.profileDirectory,
          }),
        ).rejects.toMatchObject({ code: 'INVALID_WORKSPACE' });
      } finally {
        await chmod(context.workspaceRoot, 0o700);
      }
    },
  );

  it('rejects a registered root replaced with an alias to another directory', async () => {
    const saved = await resolveWorkspaceRoot({
      rootPath: context.workspaceRoot,
      profileDirectory: context.profileDirectory,
    });
    const moved = join(directory, 'moved');
    const outside = join(directory, 'outside');
    await rename(context.workspaceRoot, moved);
    await mkdir(outside);
    await symlink(outside, saved, 'dir');
    await expect(canonicalWorkspace({ ...context, workspaceRoot: saved })).rejects.toMatchObject({
      code: 'WORKSPACE_CHANGED',
    });
  });
});

describe('portable model paths', () => {
  it('normalizes real host-relative separators before parsing model paths', () => {
    expect(
      parseWorkspaceRelativePath(
        toWorkspaceRelativePath('C:\\work', 'C:\\work\\notes 中文\\draft file.txt', 'win32'),
      ),
    ).toEqual(['notes 中文', 'draft file.txt']);
    expect(
      parseWorkspaceRelativePath(
        toWorkspaceRelativePath('/work', '/work/notes 中文/draft file.txt', 'posix'),
      ),
    ).toEqual(['notes 中文', 'draft file.txt']);
    expect(toWorkspaceRelativePath('C:\\work', 'C:\\work', 'win32')).toBe('.');
    expect(() =>
      parseWorkspaceRelativePath(toWorkspaceRelativePath('C:\\work', 'D:\\outside', 'win32')),
    ).toThrow();
    expect(() =>
      parseWorkspaceRelativePath(toWorkspaceRelativePath('C:\\work', 'C:\\outside', 'win32')),
    ).toThrow();
  });

  it.each([
    'a:b',
    'a::$DATA',
    'dir/file.',
    'dir/file ',
    'dir/.git /config',
    'CON',
    'con.txt',
    'NUL.tar.gz',
    'AUX',
    'PRN',
    'COM1.log',
    'LPT9',
    'COM¹',
    'LPT³.txt',
    'CONIN$',
    'CONOUT$',
    'CLOCK$',
    'dir/a?b',
    'dir/a*b',
    'dir/a|b',
    'dir/a<b',
    'dir/a"b',
    'dir/a\u0000b',
    'dir/a\u001fb',
  ])('rejects ambiguous filename %j before filesystem access', async (path) => {
    expect(() => parseWorkspaceRelativePath(path)).toThrow();
    await expect(
      executeTool('write_file', { path, content: 'x', expectedHash: null }, context),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('supports ordinary Unicode, spaces, extensions and names beyond reserved device aliases', () => {
    expect(parseWorkspaceRelativePath('./notes 中文/draft file.txt')).toEqual([
      'notes 中文',
      'draft file.txt',
    ]);
    expect(parseWorkspaceRelativePath('COM10/LPT10/console.txt')).toEqual([
      'COM10',
      'LPT10',
      'console.txt',
    ]);
  });

  it('creates, reads, edits, lists and searches nested files using one portable representation', async () => {
    await mkdir(join(context.workspaceRoot, 'notes 中文', 'draft folder'), { recursive: true });
    const path = 'notes 中文/draft folder/file.txt';
    const original = 'hello nested workspace';
    await executeTool('write_file', { path, content: original, expectedHash: null }, context);
    expect((await executeTool('read_file', { path }, context)).content).toEqual([
      {
        type: 'text',
        text: `SHA-256: ${hashBytes(Buffer.from(original))}\nLines: 1\n1: ${original}`,
      },
    ]);
    await executeTool(
      'edit_file',
      {
        path,
        oldText: 'hello',
        newText: 'updated',
        expectedHash: hashBytes(Buffer.from(original)),
      },
      context,
    );
    if (process.platform !== 'win32') {
      await writeFile(join(context.workspaceRoot, 'notes 中文', 'unaddressable:stream'), 'updated');
      await writeFile(join(context.workspaceRoot, 'notes 中文', 'unaddressable\\name'), 'updated');
    }
    const listed = await executeTool(
      'list_files',
      { path: 'notes 中文', recursive: true },
      context,
    );
    expect(listed.content).toEqual([{ type: 'text', text: `notes 中文/draft folder/\n${path}` }]);
    const searched = await executeTool(
      'search_files',
      { path: 'notes 中文', query: 'updated' },
      context,
    );
    expect(searched.content).toEqual([
      { type: 'text', text: `${path}:1: updated nested workspace` },
    ]);
    expect(await readFile(join(context.workspaceRoot, path), 'utf8')).toBe(
      'updated nested workspace',
    );
  });
});
