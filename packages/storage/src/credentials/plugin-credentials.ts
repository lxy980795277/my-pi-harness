import { constants, renameSync } from 'node:fs';
import { lstat, mkdir, open, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Type, type Static } from 'typebox';
import { SkillConnectionAccountSchema } from '@my-pi-harness/protocol';
import { checked } from '../shared/validation.js';
import { StorageError } from '../shared/errors.js';

export type PluginOAuthCredential = Static<typeof CredentialSchema>;

const object = { additionalProperties: false } as const;
const id = Type.String({ minLength: 1, maxLength: 160 });

const CredentialSchema = Type.Object(
  {
    accessToken: Type.String({ minLength: 1, maxLength: 65536 }),
    refreshToken: Type.Optional(Type.String({ minLength: 1, maxLength: 65536 })),
    account: Type.Union([SkillConnectionAccountSchema, Type.Null()]),
    apiUrl: Type.String({ minLength: 1, maxLength: 4096 }),
    connectedAt: Type.Integer({ minimum: 0 }),
    expiresAt: Type.Optional(Type.Integer({ minimum: 0 })),
    ownerId: id,
    identityEpoch: Type.Integer({ minimum: 1 }),
    pluginGeneration: id,
  },
  object,
);

const FileSchema = Type.Record(
  Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }),
  CredentialSchema,
  { maxProperties: 64, additionalProperties: false },
);

const MAXIMUM_BYTES = 4 * 1024 * 1024;

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Atomic, serialized 0600 JSON persistence for plugin OAuth; never used for application login. */
export class PluginCredentialStore {
  private values: Record<string, PluginOAuthCredential> = {};
  private tail: Promise<void> = Promise.resolve();
  private constructor(private readonly path: string) {}

  public static async open(path: string): Promise<PluginCredentialStore> {
    const requested = resolve(path);
    const parent = dirname(requested);
    await mkdir(parent, { mode: 0o700, recursive: true });
    if ((await lstat(parent)).isSymbolicLink())
      throw new StorageError('INVALID_RECORD', 'Plugin credential directory must not be a link');
    const store = new PluginCredentialStore(join(await realpath(parent), basename(requested)));
    await store.directory();
    let handle;
    try {
      handle = await open(store.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error: unknown) {
      if (missing(error)) return store;
      throw error;
    }
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > MAXIMUM_BYTES)
        throw new StorageError(
          'INVALID_RECORD',
          'Plugin credentials must be a bounded regular file',
        );
      if (process.getuid !== undefined && info.uid !== process.getuid())
        throw new StorageError('INVALID_RECORD', 'Plugin credentials belong to another user');
      if (process.platform !== 'win32' && (info.mode & 0o777) !== 0o600)
        throw new StorageError(
          'INVALID_RECORD',
          'Plugin credentials require private file permissions',
        );
      let value: unknown;
      try {
        value = JSON.parse(await handle.readFile('utf8'));
      } catch {
        throw new StorageError('INVALID_RECORD', 'Plugin credential JSON is invalid');
      }
      store.values = checked(FileSchema, value);
    } finally {
      await handle.close();
    }
    return store;
  }

  private async directory(): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { mode: 0o700, recursive: true });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(directory)) !== directory)
      throw new StorageError('INVALID_RECORD', 'Plugin credential directory must be canonical');
    if (process.getuid !== undefined && info.uid !== process.getuid())
      throw new StorageError(
        'INVALID_RECORD',
        'Plugin credential directory belongs to another user',
      );
  }

  public read(pluginId: string): PluginOAuthCredential | undefined {
    const value = this.values[pluginId];
    if (value === undefined) return undefined;
    return structuredClone(value);
  }

  private async serialize(operation: () => Promise<void>): Promise<void> {
    const previous = this.tail;
    let finish = (): void => undefined;
    this.tail = new Promise<void>((accept) => {
      finish = accept;
    });
    try {
      await previous;
      await operation();
    } finally {
      finish();
    }
  }

  private async persist(
    next: Record<string, PluginOAuthCredential>,
    assertCurrent: () => void,
  ): Promise<void> {
    await this.directory();
    const encoded = `${JSON.stringify(checked(FileSchema, next), null, 2)}\n`;
    if (Buffer.byteLength(encoded) > MAXIMUM_BYTES)
      throw new StorageError('INVALID_RECORD', 'Plugin credentials exceed the storage limit');
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      try {
        await handle.writeFile(encoded);
        await handle.sync();
      } finally {
        await handle.close();
      }
      assertCurrent();
      await this.directory();
      assertCurrent();
      // Revocation cannot interleave between the final guard and publishing the file and cache.
      renameSync(temporary, this.path);
      this.values = next;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  /** The owner rechecks revocation immediately before publishing staged token bytes. */
  public async set(
    pluginId: string,
    credential: PluginOAuthCredential,
    assertCurrent: () => void = () => undefined,
  ): Promise<void> {
    const owned = structuredClone(credential);
    await this.serialize(async () => {
      assertCurrent();
      await this.persist({ ...this.values, [pluginId]: owned }, assertCurrent);
    });
  }

  public async delete(
    pluginId: string,
    assertCurrent: () => void = () => undefined,
  ): Promise<void> {
    await this.serialize(async () => {
      assertCurrent();
      if (this.values[pluginId] === undefined) return;
      const next = { ...this.values };
      delete next[pluginId];
      await this.persist(next, assertCurrent);
    });
  }

  public async close(): Promise<void> {
    await this.tail;
  }
}
