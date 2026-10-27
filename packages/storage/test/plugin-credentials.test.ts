import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { PluginCredentialStore, type PluginOAuthCredential } from '../src/index.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'plugin-credential-store-'));
  directories.push(directory);
  const path = join(directory, 'skill-credentials.json');
  return { directory, path, store: await PluginCredentialStore.open(path) };
}
function credential(accessToken: string): PluginOAuthCredential {
  return {
    accessToken,
    account: { id: '123', username: 'fixture', displayName: 'Fixture', avatarUrl: null },
    apiUrl: 'https://api.github.com',
    connectedAt: 100,
    ownerId: 'owner',
    identityEpoch: 1,
    pluginGeneration: 'generation',
  };
}

it('writes one private JSON credential per plugin and reopens without any OS credential dependency', async () => {
  const f = await fixture();
  await Promise.all([
    f.store.set('github', credential('first-token')),
    f.store.set('google', credential('second-token')),
  ]);
  if (process.platform !== 'win32') expect((await stat(f.path)).mode & 0o777).toBe(0o600);
  const reopened = await PluginCredentialStore.open(f.path);
  expect(reopened.read('github')?.accessToken).toBe('first-token');
  expect(reopened.read('google')?.accessToken).toBe('second-token');
  const copy = reopened.read('github');
  if (copy === undefined) throw new Error('Missing stored credential');
  copy.accessToken = 'changed-copy';
  expect(reopened.read('github')?.accessToken).toBe('first-token');
  await f.store.delete('github');
  expect((await PluginCredentialStore.open(f.path)).read('github')).toBeUndefined();
  expect(await readFile(f.path, 'utf8')).not.toContain('first-token');
});

it('a failed revocation guard retains both the previous file and previous cached credential', async () => {
  const f = await fixture();
  await f.store.set('github', credential('original'));
  let checks = 0;
  await expect(
    f.store.set('github', credential('revoked'), () => {
      checks += 1;
      if (checks > 1) throw new Error('Revoked');
    }),
  ).rejects.toThrow('Revoked');
  expect(f.store.read('github')?.accessToken).toBe('original');
  expect(await readFile(f.path, 'utf8')).not.toContain('revoked');
  expect(await readdir(f.directory)).toEqual(['skill-credentials.json']);
  await f.store.set('github', credential('next'));
  expect(f.store.read('github')?.accessToken).toBe('next');
});

it('rejects damaged, linked and nonprivate token files without exposing their content', async () => {
  const f = await fixture();
  await writeFile(f.path, '{"github":{"accessToken":"sensitive-invalid-record"}}', { mode: 0o600 });
  await expect(PluginCredentialStore.open(f.path)).rejects.toThrow('validation');
  await rm(f.path);
  const target = join(f.directory, 'target');
  await writeFile(target, '{}', { mode: 0o600 });
  await symlink(target, f.path);
  await expect(PluginCredentialStore.open(f.path)).rejects.toThrow();
  await rm(f.path);
  if (process.platform !== 'win32') {
    await writeFile(f.path, '{}', { mode: 0o644 });
    await expect(PluginCredentialStore.open(f.path)).rejects.toThrow('private file permissions');
  }
});
