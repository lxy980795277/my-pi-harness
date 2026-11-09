import type { LookupAddress } from 'node:dns';
import { Resolver } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { SandboxError } from '../errors';

/**
 * Resolve with an owned, cancellable resolver and validate every answer before selecting a socket target.
 * The caller owns address policy, including any exact host-authorized fixture exception.
 * @param hostname Host without URL brackets.
 * @param signal Cancels outstanding DNS queries and rejects late answers.
 * @param assertAddress Rejects an address that the caller must not contact.
 * @returns The first validated address; an empty result raises DNS_FAILED.
 */
export async function resolveSocketAddress(
  hostname: string,
  signal: AbortSignal,
  assertAddress: (address: string) => void,
): Promise<LookupAddress> {
  signal.throwIfAborted();
  const family = isIP(hostname);
  if (family !== 0) {
    assertAddress(hostname);
    return { address: hostname, family };
  }
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  const cancel = (): void => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const results = await Promise.allSettled([
      resolver.resolve4(hostname),
      resolver.resolve6(hostname),
    ]);
    signal.throwIfAborted();
    const addresses = results.flatMap((result, index) =>
      result.status === 'fulfilled'
        ? result.value.map((address) => ({ address, family: index === 0 ? 4 : 6 }))
        : [],
    );
    for (const address of addresses) assertAddress(address.address);
    const selected = addresses[0];
    if (selected === undefined)
      throw new SandboxError('DNS_FAILED', 'The hostname could not be resolved');
    return selected;
  } finally {
    signal.removeEventListener('abort', cancel);
    resolver.cancel();
  }
}

/**
 * Pin Node's single- and multi-address lookup callbacks to one previously validated socket target.
 * @param selected Address selected for this request, copied before the callback is returned.
 * @returns A lookup function that performs no further DNS queries.
 */
export function createPinnedLookup({ address, family }: LookupAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}
