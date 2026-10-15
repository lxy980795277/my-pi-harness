import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';

/** One opaque secret update, where an undefined value explicitly deletes the entry. */
export interface SecretUpdate<T> {
  value: string | undefined;
  result: T;
}

/** Secrets remain server-side; a modify call holds serialization throughout token refresh. */
export interface CredentialStore {
  read(ref: string): Promise<string | undefined>;
  write(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
  list(): Promise<string[]>;
  modify<T>(
    ref: string,
    updater: (current: string | undefined) => Promise<SecretUpdate<T>>,
  ): Promise<T>;
}

/** Async platform adapter; missing entries differ from locked or unavailable stores. */
export interface CredentialBackend {
  read(ref: string): Promise<string | undefined>;
  write(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
  list(): Promise<string[]>;
}

/**
 * Serialize all operations on each ref; failures do not poison its next operation.
 * @param backend Actual system store or an explicitly injected test adapter.
 * @returns An opaque credential store whose updater must not recursively call the same ref.
 */
export function createCredentialStore(backend: CredentialBackend): CredentialStore {
  const tails = new Map<string, Promise<void>>();
  const serialize = <T>(ref: string, operation: () => Promise<T>): Promise<T> => {
    const previous = tails.get(ref) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(ref, tail);
    void tail.then(() => {
      if (tails.get(ref) === tail) tails.delete(ref);
    });
    return result;
  };
  return {
    read(ref): Promise<string | undefined> {
      return serialize(ref, () => backend.read(ref));
    },
    write(ref, value): Promise<void> {
      return serialize(ref, () => backend.write(ref, value));
    },
    delete(ref): Promise<void> {
      return serialize(ref, () => backend.delete(ref));
    },
    async list(): Promise<string[]> {
      await Promise.all([...tails.values()]);
      return backend.list();
    },
    modify<T>(
      ref: string,
      updater: (current: string | undefined) => Promise<SecretUpdate<T>>,
    ): Promise<T> {
      return serialize(ref, async () => {
        const update = await updater(await backend.read(ref));
        if (update.value === undefined) await backend.delete(ref);
        else await backend.write(ref, update.value);
        return update.result;
      });
    },
  };
}

/**
 * Use only the application's profile-specific OS credential namespace.
 * No missing or unavailable system store falls back to plaintext or memory.
 * @param profileDirectory Existing profile directory used to derive a stable namespace.
 * @returns A native async Keychain/Windows credential adapter with per-ref serialization.
 */
export async function createSystemCredentialStore(
  profileDirectory: string,
): Promise<CredentialStore> {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    throw new Error('Persistent system credentials currently require macOS or Windows');
  }
  const directory = await realpath(profileDirectory);
  const namespace = `com.liuxinyu.my-pi-harness.${createHash('sha256').update(directory).digest('hex')}`;
  const { AsyncEntry, findCredentialsAsync } = await import('@napi-rs/keyring');
  return createCredentialStore({
    async read(ref): Promise<string | undefined> {
      return (await new AsyncEntry(namespace, ref).getPassword()) ?? undefined;
    },
    async write(ref, value): Promise<void> {
      await new AsyncEntry(namespace, ref).setPassword(value);
    },
    async delete(ref): Promise<void> {
      await new AsyncEntry(namespace, ref).deletePassword();
    },
    async list(): Promise<string[]> {
      return (await findCredentialsAsync(namespace)).map((credential) => credential.account).sort();
    },
  });
}

/**
 * Create an explicit in-memory test store; production never selects it implicitly.
 * @param initial Opaque test secrets, not real user credentials.
 * @returns The same serialized interface as the system adapter.
 */
export function createMemoryCredentialStore(
  initial: ReadonlyMap<string, string> = new Map(),
): CredentialStore {
  const values = new Map(initial);
  return createCredentialStore({
    read(ref): Promise<string | undefined> {
      return Promise.resolve(values.get(ref));
    },
    write(ref, value): Promise<void> {
      values.set(ref, value);
      return Promise.resolve();
    },
    delete(ref): Promise<void> {
      values.delete(ref);
      return Promise.resolve();
    },
    list(): Promise<string[]> {
      return Promise.resolve([...values.keys()].sort());
    },
  });
}
