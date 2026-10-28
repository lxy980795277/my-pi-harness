import { BlockList, isIP, type IPVersion } from 'node:net';

type Subnet = readonly [address: string, prefix: number];

const deniedV4 = createBlockList(
  [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ] as const,
  'ipv4',
);
const mappedV4 = createBlockList([['::ffff:0:0', 96]], 'ipv6');
const allowedV6 = createBlockList([['2000::', 3]], 'ipv6');
const deniedV6 = createBlockList(
  [
    ['2001::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['3fff::', 20],
  ] as const,
  'ipv6',
);

/**
 * Apply the same public-address policy to native IPs and IPv4-mapped IPv6 literals.
 * @param address IP literal returned by DNS or supplied as a URL host.
 * @returns Whether the literal is permitted; mapped addresses inherit their embedded IPv4 policy.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !deniedV4.check(address, 'ipv4');
  if (family !== 6) return false;
  if (mappedV4.check(address, 'ipv6')) return !deniedV4.check(address, 'ipv6');
  return allowedV6.check(address, 'ipv6') && !deniedV6.check(address, 'ipv6');
}

function createBlockList(subnets: readonly Subnet[], family: IPVersion): BlockList {
  const list = new BlockList();
  for (const [address, prefix] of subnets) list.addSubnet(address, prefix, family);
  return list;
}
