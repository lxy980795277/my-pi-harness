import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSystemCredentialStore } from '../src/index.js';

const native = vi.hoisted(() => ({
  entries: new Map<string, Map<string, string>>(),
  unavailable: false,
}));

vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    public constructor(
      private readonly service: string,
      private readonly ref: string,
    ) {}
    public getPassword(): Promise<string | undefined> {
      if (native.unavailable)
        return Promise.reject(new Error('Native credential store unavailable'));
      return Promise.resolve(native.entries.get(this.service)?.get(this.ref));
    }
    public setPassword(value: string): Promise<void> {
      const entries = native.entries.get(this.service) ?? new Map<string, string>();
      entries.set(this.ref, value);
      native.entries.set(this.service, entries);
      return Promise.resolve();
    }
    public deletePassword(): Promise<boolean> {
      return Promise.resolve(native.entries.get(this.service)?.delete(this.ref) ?? false);
    }
  },
  findCredentialsAsync(service: string): Promise<{ account: string; password: string }[]> {
    return Promise.resolve(
      [...(native.entries.get(service)?.entries() ?? [])].map(([account, password]) => ({
        account,
        password,
      })),
    );
  },
}));

const directories: string[] = [];

async function profile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-keyring-adapter-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  native.entries.clear();
  native.unavailable = false;
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe.runIf(process.platform === 'darwin' || process.platform === 'win32')(
  'system credential binding with an injected native fixture',
  () => {
    it('returns only refs from enumeration and distinguishes a missing secret from failure', async () => {
      const store = await createSystemCredentialStore(await profile());
      expect(await store.read('missing')).toBeUndefined();
      await store.write('credential-b', 'fake secret');
      await store.write('credential-a', 'another fake secret');
      expect(await store.list()).toEqual(['credential-a', 'credential-b']);
      await store.delete('credential-a');
      await store.delete('credential-a');
      expect(await store.list()).toEqual(['credential-b']);
    });

    it('isolates the same credentialRef across canonical profile namespaces', async () => {
      const first = await createSystemCredentialStore(await profile());
      const second = await createSystemCredentialStore(await profile());
      await first.write('shared-ref', 'first fake');
      await second.write('shared-ref', 'second fake');
      expect(await first.read('shared-ref')).toBe('first fake');
      expect(await second.read('shared-ref')).toBe('second fake');
      expect(native.entries.size).toBe(2);
    });

    it('propagates native access failure without replacing it with an absent credential', async () => {
      const store = await createSystemCredentialStore(await profile());
      await store.write('credential', 'fake value');
      native.unavailable = true;
      await expect(store.read('credential')).rejects.toThrow('unavailable');
      native.unavailable = false;
      expect(await store.read('credential')).toBe('fake value');
    });
  },
);
