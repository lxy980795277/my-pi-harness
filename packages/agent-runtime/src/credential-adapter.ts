import type { AuthOperationOptions, Credential, CredentialStore } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { RuntimeError } from './errors.js';

/** Host-owned secret storage; modify serializes the entire asynchronous refresh. */
export interface SecretStore {
  read(ref: string): Promise<string | undefined>;
  write(ref: string, secret: string): Promise<void>;
  delete(ref: string): Promise<void>;
  list(): Promise<string[]>;
  modify<T>(
    ref: string,
    updater: (current: string | undefined) => Promise<{ value: string | undefined; result: T }>,
  ): Promise<T>;
}

/** Detached token rotation must settle before the daemon closes its owner process. */
export interface ManagedPiCredentialStore extends CredentialStore {
  waitForIdle(): Promise<void>;
}

const credentialSchema = Type.Union([
  Type.Object({
    type: Type.Literal('api_key'),
    key: Type.Optional(Type.String()),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
  }),
  Type.Object({
    type: Type.Literal('oauth'),
    refresh: Type.String(),
    access: Type.String(),
    expires: Type.Number({ minimum: 0 }),
  }),
]);
const envelopeSchema = Type.Object({ version: Type.Literal(1), credential: credentialSchema });

/** Decode private keyring data; malformed secrets never become missing credentials. */
export function decodeCredential(serialized: string): Credential {
  let input: unknown;
  try {
    input = JSON.parse(serialized);
  } catch (cause) {
    throw new RuntimeError('CREDENTIAL_CORRUPT', 'Stored credential is not valid JSON', { cause });
  }
  if (!Value.Check(envelopeSchema, input)) {
    throw new RuntimeError('CREDENTIAL_CORRUPT', 'Stored credential has an unsupported format');
  }
  return input.credential;
}

/** Pi provider IDs are account instances; resolveRef selects their host secret entry. */
export function createPiCredentialStore(
  secrets: SecretStore,
  resolveRef: (providerId: string) => string,
  registeredIds: () => readonly string[],
): ManagedPiCredentialStore {
  const pending = new Set<Promise<unknown>>();
  const track = <T>(operation: Promise<T>): Promise<T> => {
    pending.add(operation);
    void operation.then(
      () => {
        pending.delete(operation);
      },
      () => {
        pending.delete(operation);
      },
    );
    return operation;
  };
  const checkSignal = (options?: AuthOperationOptions): void => {
    options?.signal?.throwIfAborted();
  };
  return {
    read(providerId, options) {
      return track(
        (async () => {
          checkSignal(options);
          const value = await secrets.read(resolveRef(providerId));
          checkSignal(options);
          return value === undefined ? undefined : decodeCredential(value);
        })(),
      );
    },
    list(options) {
      return track(
        (async () => {
          checkSignal(options);
          const refs = new Set(await secrets.list());
          const entries = [];
          for (const providerId of registeredIds()) {
            checkSignal(options);
            if (!refs.has(resolveRef(providerId))) continue;
            const value = await secrets.read(resolveRef(providerId));
            if (value !== undefined)
              entries.push({ providerId, type: decodeCredential(value).type });
          }
          return entries;
        })(),
      );
    },
    modify(providerId, updater, options) {
      checkSignal(options);
      return track(
        secrets.modify(resolveRef(providerId), async (serialized) => {
          checkSignal(options);
          const current = serialized === undefined ? undefined : decodeCredential(serialized);
          const next = await updater(current);
          // A refresh may rotate its token after caller cancellation; persist before returning.
          return {
            value:
              next === undefined ? serialized : JSON.stringify({ version: 1, credential: next }),
            result: next ?? current,
          };
        }),
      );
    },
    delete(providerId, options) {
      checkSignal(options);
      return track(secrets.delete(resolveRef(providerId)));
    },
    async waitForIdle() {
      const failures: unknown[] = [];
      while (pending.size > 0) {
        const results = await Promise.allSettled([...pending]);
        for (const result of results)
          if (result.status === 'rejected') failures.push(result.reason);
      }
      if (failures.length > 0)
        throw new AggregateError(failures, 'Credential operations did not finish');
    },
  };
}
