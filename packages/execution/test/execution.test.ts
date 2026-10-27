import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  describeTool,
  executeTool,
  TOOL_DEFINITIONS,
  type ExecutionContext,
} from '../src/index.js';
import { hashBytes } from '../src/filesystem/tools.js';

let directory: string;
let context: ExecutionContext;
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'execution-test-')));
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

function text(result: Awaited<ReturnType<typeof executeTool>>): string {
  return result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
}

describe('validated tool execution', () => {
  it('publishes seven schemas and previews effects without touching the workspace', () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      'read_file',
      'list_files',
      'search_files',
      'write_file',
      'edit_file',
      'shell',
      'web_fetch',
    ]);
    expect(describeTool('read_file', { path: 'missing' })).toMatchObject({
      approvalRequired: false,
      mutating: false,
    });
    expect(describeTool('web_fetch', { url: 'https://example.com', method: 'POST' })).toMatchObject(
      { approvalRequired: true, mutating: true },
    );
    expect(() => describeTool('shell', { command: 'ls', extra: true })).toThrow(
      'Invalid arguments',
    );
    expect(() => describeTool('web_fetch', { url: 'https://example.com', body: 'x' })).toThrow(
      'requires POST',
    );
  });

  it('creates, reads and edits with a preimage hash and a real unified diff', async () => {
    const created = await executeTool(
      'write_file',
      { path: 'hello.txt', content: 'hello\nworld\n', expectedHash: null },
      context,
    );
    expect(created.diff).toContain('+hello');
    const originalHash = hashBytes(Buffer.from('hello\nworld\n'));
    const read = await executeTool(
      'read_file',
      { path: 'hello.txt', startLine: 2, maxLines: 1 },
      context,
    );
    expect(text(read)).toContain(`SHA-256: ${originalHash}`);
    expect(text(read)).toContain('2: world');
    const edited = await executeTool(
      'edit_file',
      { path: 'hello.txt', oldText: 'world', newText: 'workspace', expectedHash: originalHash },
      context,
    );
    expect(edited.diff).toContain('-world');
    expect(edited.diff).toContain('+workspace');
    expect(await readFile(join(context.workspaceRoot, 'hello.txt'), 'utf8')).toBe(
      'hello\nworkspace\n',
    );
  });

  it('rejects stale updates, accidental overwrites and ambiguous replacement', async () => {
    await writeFile(join(context.workspaceRoot, 'a'), 'x x');
    await expect(
      executeTool('write_file', { path: 'a', content: 'new', expectedHash: null }, context),
    ).rejects.toMatchObject({ code: 'PREIMAGE_MISMATCH' });
    await expect(
      executeTool(
        'edit_file',
        { path: 'a', oldText: 'x', newText: 'y', expectedHash: hashBytes(Buffer.from('x x')) },
        context,
      ),
    ).rejects.toMatchObject({ code: 'EDIT_AMBIGUOUS' });
    await expect(
      executeTool(
        'write_file',
        { path: 'a', content: 'new', expectedHash: '0'.repeat(64) },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PREIMAGE_MISMATCH' });
    const result = await executeTool(
      'edit_file',
      {
        path: 'a',
        oldText: 'x',
        newText: 'y',
        replaceAll: true,
        expectedHash: hashBytes(Buffer.from('x x')),
      },
      context,
    );
    expect(result.diff).toContain('+y y');
  });

  it.each(['../outside', '/etc/passwd', 'C:/private', 'a\\b', '.ssh/key', '.env', '.git/config'])(
    'refuses non-workspace or protected file path %s',
    async (path) => {
      await expect(executeTool('read_file', { path }, context)).rejects.toHaveProperty('code');
    },
  );

  it('refuses linked parents, linked files and hard-linked writes', async () => {
    const outside = join(directory, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret'), 'private');
    await symlink(outside, join(context.workspaceRoot, 'linked'));
    await symlink(join(outside, 'secret'), join(context.workspaceRoot, 'alias'));
    await expect(
      executeTool('read_file', { path: 'linked/secret' }, context),
    ).rejects.toMatchObject({ code: 'SYMLINK_PATH' });
    await expect(executeTool('read_file', { path: 'alias' }, context)).rejects.toMatchObject({
      code: 'SYMLINK_PATH',
    });
    await link(join(outside, 'secret'), join(context.workspaceRoot, 'hard'));
    await expect(executeTool('read_file', { path: 'hard' }, context)).rejects.toMatchObject({
      code: 'HARDLINK_FILE',
    });
    await expect(
      executeTool(
        'write_file',
        { path: 'hard', content: 'replacement', expectedHash: hashBytes(Buffer.from('private')) },
        context,
      ),
    ).rejects.toMatchObject({ code: 'HARDLINK_FILE' });
    expect(await readFile(join(outside, 'secret'), 'utf8')).toBe('private');
  });

  it('does not allow a workspace to expose the application profile', async () => {
    await expect(
      executeTool('list_files', {}, { ...context, workspaceRoot: directory }),
    ).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
    await expect(
      executeTool('list_files', {}, { ...context, workspaceRoot: context.profileDirectory }),
    ).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
  });

  it('lists and literally searches bounded results while excluding links and credentials', async () => {
    await mkdir(join(context.workspaceRoot, 'src'));
    await writeFile(join(context.workspaceRoot, 'src', 'a.txt'), 'a.*b\nA.*B\nother');
    await writeFile(join(context.workspaceRoot, '.env.local'), 'a.*b secret');
    await symlink(join(context.workspaceRoot, 'src'), join(context.workspaceRoot, 'alias'));
    const listed = text(await executeTool('list_files', { recursive: true }, context));
    expect(listed).toContain('src/a.txt');
    expect(listed).not.toContain('.env');
    expect(listed).not.toContain('alias');
    const searched = text(
      await executeTool('search_files', { query: 'a.*b', maxResults: 1 }, context),
    );
    expect(searched).toContain('src/a.txt:1: a.*b');
    expect(searched).toContain('truncated');
  });

  it.each(['sandboxed', 'full-access'] as const)(
    'keeps application logs out of file tools with %s shell access',
    async (shellAccess) => {
      const protectedContext = { ...context, shellAccess };
      const logPath = '.my-pi-harness/sessions/session.jsonl';
      const original = 'private-log-marker';
      await mkdir(join(context.workspaceRoot, '.my-pi-harness', 'sessions'), {
        recursive: true,
      });
      await writeFile(join(context.workspaceRoot, logPath), original);
      await writeFile(join(context.workspaceRoot, 'visible.txt'), 'ordinary-log-marker');
      const operations = [
        { name: 'read_file', args: { path: logPath } },
        {
          name: 'write_file',
          args: { path: '.my-pi-harness/new.jsonl', content: 'new', expectedHash: null },
        },
        {
          name: 'edit_file',
          args: {
            path: logPath,
            oldText: original,
            newText: 'changed',
            expectedHash: hashBytes(Buffer.from(original)),
          },
        },
        { name: 'list_files', args: { path: '.my-pi-harness', recursive: true } },
        { name: 'search_files', args: { path: '.my-pi-harness', query: 'log-marker' } },
      ];
      for (const operation of operations)
        await expect(
          executeTool(operation.name, operation.args, protectedContext),
        ).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
      expect(text(await executeTool('list_files', { recursive: true }, protectedContext))).toBe(
        'visible.txt',
      );
      expect(
        text(await executeTool('search_files', { query: 'log-marker' }, protectedContext)),
      ).toBe('visible.txt:1: ordinary-log-marker');
      expect(await readFile(join(context.workspaceRoot, logPath), 'utf8')).toBe(original);
      await expect(
        readFile(join(context.workspaceRoot, '.my-pi-harness', 'new.jsonl')),
      ).rejects.toHaveProperty('code', 'ENOENT');
    },
  );

  it('returns bounded image content separately from text', async () => {
    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
      'base64',
    );
    await writeFile(join(context.workspaceRoot, 'image.png'), image);
    const result = await executeTool('read_file', { path: 'image.png' }, context);
    expect(result.content[1]).toEqual({
      type: 'image',
      data: image.toString('base64'),
      mimeType: 'image/png',
    });
    expect(result.summary).not.toContain(image.toString('base64'));
  });

  it('fails closed for read-only policy and cancellation before side effects', async () => {
    await expect(
      executeTool(
        'write_file',
        { path: 'a', content: 'x', expectedHash: null },
        { ...context, readOnly: true },
      ),
    ).rejects.toMatchObject({ code: 'READ_ONLY' });
    await expect(
      executeTool(
        'web_fetch',
        { url: 'https://example.com', method: 'POST' },
        { ...context, readOnly: true },
      ),
    ).rejects.toMatchObject({ code: 'READ_ONLY' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeTool('list_files', {}, { ...context, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(
      executeTool('read_file', { path: 'a', unknown: true }, context),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
  });
});
