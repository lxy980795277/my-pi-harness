import * as fs from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openProfileStore, sessionLogDirectory, type ProfileStore } from '../src/index.js';
import { SessionBatchSchema } from '../src/sessions/session-jsonl.js';
import { checked } from '../src/shared/validation.js';

vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }));

const directories: string[] = [];
const stores: ProfileStore[] = [];
async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-log-root-'));
  directories.push(directory);
  return fs.realpathSync(directory);
}
async function open(directory: string, sessionLogRoot?: string): Promise<ProfileStore> {
  const store = await openProfileStore(
    directory,
    sessionLogRoot === undefined ? {} : { sessionLogRoot },
  );
  stores.push(store);
  return store;
}
function createSession(store: ProfileStore, title: string): void {
  store.createSession({
    id: 'same-session',
    branchId: 'main',
    title,
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: null,
    approvalMode: 'ask',
    at: 1,
  });
}
function file(profile: string, root: string): string {
  return join(sessionLogDirectory(profile, root), 'same-session.jsonl');
}
async function logged(profile: string, root: string) {
  const text = await readFile(file(profile, root), 'utf8');
  return text
    .trimEnd()
    .split('\n')
    .flatMap((line) =>
      checked(SessionBatchSchema, JSON.parse(line)).records.map((record) => record.event),
    );
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('profile-isolated hidden session log roots', () => {
  it('rejects switching to an empty root while SQLite still indexes authoritative session history', async () => {
    const base = await temporaryDirectory();
    const profile = join(base, 'profile');
    const store = await open(profile);
    createSession(store, 'Saved history');
    store.close();
    const nextRoot = join(base, '.my-pi-harness');
    await expect(openProfileStore(profile, { sessionLogRoot: nextRoot })).rejects.toThrow(
      'authoritative session journal is missing',
    );
  });

  it('keeps identical session IDs separate for two independently owned profiles sharing one root', async () => {
    const base = await temporaryDirectory();
    const root = join(base, '.my-pi-harness');
    const firstProfile = join(base, 'first');
    const secondProfile = join(base, 'second');
    const first = await open(firstProfile, root);
    const second = await open(secondProfile, root);
    createSession(first, 'First profile');
    createSession(second, 'Second profile');
    expect(sessionLogDirectory(firstProfile, root)).not.toBe(
      sessionLogDirectory(secondProfile, root),
    );
    expect(await logged(firstProfile, root)).toEqual(first.readEvents('same-session'));
    expect(await logged(secondProfile, root)).toEqual(second.readEvents('same-session'));
    await expect(openProfileStore(firstProfile, { sessionLogRoot: root })).rejects.toMatchObject({
      code: 'PROFILE_LOCKED',
    });
    first.close();
    const reopened = await open(firstProfile, root);
    expect(await logged(firstProfile, root)).toEqual(reopened.readEvents('same-session'));
    second.append('same-session', [{ type: 'audit.saved', data: {}, runId: null, at: 2 }]);
    expect(await logged(secondProfile, root)).toEqual(second.readEvents('same-session'));
    expect(reopened.readEvents('same-session')).toHaveLength(1);
  });

  it.each(['relative', 'wrong-name', 'profile-inside-root', 'profile-equals-root'])(
    'rejects %s before opening or creating the profile',
    async (kind) => {
      const base = await temporaryDirectory();
      let root = join(base, '.my-pi-harness');
      let profile = join(base, 'profile');
      if (kind === 'relative') root = '.my-pi-harness';
      if (kind === 'wrong-name') root = join(base, 'logs');
      if (kind === 'profile-inside-root') profile = join(root, 'profile');
      if (kind === 'profile-equals-root') profile = root;
      await expect(openProfileStore(profile, { sessionLogRoot: root })).rejects.toMatchObject({
        code: 'INVALID_RECORD',
      });
      expect(fs.existsSync(profile)).toBe(false);
    },
  );

  it.each(['root', 'sessions', 'namespace'])(
    'rejects a %s symlink, closes partially acquired directories and releases profile ownership',
    async (target) => {
      const base = await temporaryDirectory();
      const profile = join(base, 'profile');
      const root = join(base, '.my-pi-harness');
      await mkdir(profile);
      const namespace = sessionLogDirectory(profile, root);
      const outside = join(base, 'outside');
      await mkdir(outside);
      await writeFile(join(outside, 'sentinel'), 'keep');
      let linkPath = root;
      if (target === 'sessions') {
        await mkdir(root);
        linkPath = join(root, 'sessions');
      }
      if (target === 'namespace') {
        await mkdir(join(root, 'sessions'), { recursive: true });
        linkPath = namespace;
      }
      await symlink(outside, linkPath, 'junction');
      const openedDirectories: number[] = [];
      const actual = await vi.importActual<typeof fs>('node:fs');
      const opening = vi.spyOn(fs, 'openSync').mockImplementation((path, flags, mode) => {
        const fd = actual.openSync(path, flags, mode);
        if (actual.fstatSync(fd).isDirectory()) openedDirectories.push(fd);
        return fd;
      });
      try {
        await expect(openProfileStore(profile, { sessionLogRoot: root })).rejects.toMatchObject({
          code: 'SESSION_LOG_INVALID',
        });
        if (process.platform !== 'win32') expect(openedDirectories.length).toBeGreaterThan(0);
        for (const fd of openedDirectories)
          expect(() => actual.fstatSync(fd)).toThrow(expect.objectContaining({ code: 'EBADF' }));
      } finally {
        opening.mockRestore();
      }
      expect(await readFile(join(outside, 'sentinel'), 'utf8')).toBe('keep');
      expect(await fs.promises.readdir(outside)).toEqual(['sentinel']);
      await rm(linkPath);
      const reopened = await open(profile, root);
      createSession(reopened, 'Recovered ownership');
      expect(await logged(profile, root)).toEqual(reopened.readEvents('same-session'));
    },
  );
});
