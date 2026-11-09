import { beforeEach, expect, it, vi } from 'vitest';
import { createPinnedLookup, isPublicAddress, resolveSocketAddress } from '../src/network';

const dns = vi.hoisted(() => ({
  create: vi.fn(),
  resolve4: vi.fn<(hostname: string) => Promise<string[]>>(),
  resolve6: vi.fn<(hostname: string) => Promise<string[]>>(),
  cancel: vi.fn<() => void>(),
}));

vi.mock('node:dns/promises', () => ({
  Resolver: class {
    public constructor(options: unknown) {
      dns.create(options);
    }
    public resolve4(hostname: string): Promise<string[]> {
      return dns.resolve4(hostname);
    }
    public resolve6(hostname: string): Promise<string[]> {
      return dns.resolve6(hostname);
    }
    public cancel(): void {
      dns.cancel();
    }
  },
}));

function assertPublic(address: string): void {
  if (!isPublicAddress(address)) throw new Error('Forbidden address');
}

beforeEach(() => {
  vi.resetAllMocks();
  dns.resolve4.mockResolvedValue(['8.8.8.8']);
  dns.resolve6.mockResolvedValue([]);
});

it('validates all A and AAAA answers before selecting the first address', async () => {
  dns.resolve6.mockResolvedValue(['2606:4700:4700::1111', '::ffff:127.0.0.1']);
  await expect(
    resolveSocketAddress('public.example', new AbortController().signal, assertPublic),
  ).rejects.toThrow('Forbidden address');
  expect(dns.cancel).toHaveBeenCalledOnce();
});

it('uses the remaining address family when the other DNS query fails', async () => {
  dns.resolve4.mockRejectedValue(new Error('No A records'));
  dns.resolve6.mockResolvedValue(['2606:4700:4700::1111']);
  await expect(
    resolveSocketAddress('public.example', new AbortController().signal, assertPublic),
  ).resolves.toEqual({ address: '2606:4700:4700::1111', family: 6 });
  expect(dns.create).toHaveBeenCalledWith({ timeout: 3000, tries: 1 });
  expect(dns.resolve4).toHaveBeenCalledWith('public.example');
  expect(dns.resolve6).toHaveBeenCalledWith('public.example');
});

it('reports an empty resolution without preserving resolver diagnostics', async () => {
  dns.resolve4.mockRejectedValue(new Error('Private resolver diagnostic'));
  await expect(
    resolveSocketAddress('public.example', new AbortController().signal, assertPublic),
  ).rejects.toMatchObject({ code: 'DNS_FAILED', message: 'The hostname could not be resolved' });
  expect(dns.cancel).toHaveBeenCalledOnce();
});

it('validates IP literals without creating a resolver', async () => {
  await expect(
    resolveSocketAddress('8.8.8.8', new AbortController().signal, assertPublic),
  ).resolves.toEqual({ address: '8.8.8.8', family: 4 });
  await expect(
    resolveSocketAddress('::ffff:127.0.0.1', new AbortController().signal, assertPublic),
  ).rejects.toThrow('Forbidden address');
  expect(dns.create).not.toHaveBeenCalled();
});

it('does not begin DNS after cancellation', async () => {
  const controller = new AbortController();
  const reason = new Error('Request stopped');
  controller.abort(reason);
  await expect(
    resolveSocketAddress('public.example', controller.signal, assertPublic),
  ).rejects.toBe(reason);
  expect(dns.create).not.toHaveBeenCalled();
});

it('cancels outstanding queries and rejects answers observed after the owner aborts', async () => {
  const controller = new AbortController();
  const reason = new Error('Request stopped');
  let completeA: (addresses: string[]) => void = () => {
    throw new Error('A query has not started');
  };
  let completeAAAA: (addresses: string[]) => void = () => {
    throw new Error('AAAA query has not started');
  };
  dns.resolve4.mockImplementation(
    () =>
      new Promise((accept) => {
        completeA = accept;
      }),
  );
  dns.resolve6.mockImplementation(
    () =>
      new Promise((accept) => {
        completeAAAA = accept;
      }),
  );
  const request = resolveSocketAddress('public.example', controller.signal, assertPublic);
  const assertion = expect(request).rejects.toBe(reason);
  controller.abort(reason);
  expect(dns.cancel).toHaveBeenCalledOnce();
  completeA(['8.8.8.8']);
  completeAAAA(['2606:4700:4700::1111']);
  await assertion;
  expect(dns.cancel).toHaveBeenCalledTimes(2);
});

it('removes its abort listener after resolution completes', async () => {
  const controller = new AbortController();
  await resolveSocketAddress('public.example', controller.signal, assertPublic);
  expect(dns.cancel).toHaveBeenCalledOnce();
  controller.abort();
  expect(dns.cancel).toHaveBeenCalledOnce();
});

it('pins both Node lookup forms to a copied address without resolving again', () => {
  const selected = { address: '8.8.8.8', family: 4 };
  const lookup = createPinnedLookup(selected);
  selected.address = '127.0.0.1';
  const callback = vi.fn();
  lookup('public.example', {}, callback);
  expect(callback).toHaveBeenLastCalledWith(null, '8.8.8.8', 4);
  lookup('public.example', { all: true }, callback);
  expect(callback).toHaveBeenLastCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
  expect(dns.create).not.toHaveBeenCalled();
});
