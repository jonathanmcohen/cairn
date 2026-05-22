import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** Reserved/internal IP ranges we refuse to POST to (SSRF defense). */
function buildBlockList(): BlockList {
  const bl = new BlockList();
  // IPv4
  bl.addSubnet('0.0.0.0', 8); // "this" network / 0.0.0.0
  bl.addSubnet('10.0.0.0', 8); // private
  bl.addSubnet('100.64.0.0', 10); // CGNAT
  bl.addSubnet('127.0.0.0', 8); // loopback
  bl.addSubnet('169.254.0.0', 16); // link-local (incl. 169.254.169.254 metadata)
  bl.addSubnet('172.16.0.0', 12); // private
  bl.addSubnet('192.0.0.0', 24); // IETF protocol assignments
  bl.addSubnet('192.168.0.0', 16); // private
  bl.addSubnet('198.18.0.0', 15); // benchmarking
  bl.addSubnet('224.0.0.0', 4); // multicast
  bl.addSubnet('240.0.0.0', 4); // reserved
  // IPv6
  bl.addAddress('::1', 'ipv6'); // loopback
  bl.addAddress('::', 'ipv6'); // unspecified
  bl.addSubnet('fc00::', 7, 'ipv6'); // unique-local
  bl.addSubnet('fe80::', 10, 'ipv6'); // link-local
  bl.addSubnet('ff00::', 8, 'ipv6'); // multicast
  return bl;
}

const BLOCKED = buildBlockList();

function isBlocked(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true; // unparseable → refuse
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) must be checked as its embedded v4.
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped?.[1]) return BLOCKED.check(mapped[1], 'ipv4');
  return BLOCKED.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/**
 * Throws unless `rawUrl` is an http(s) URL whose host resolves ENTIRELY to
 * public addresses. Resolution happens here (not just literal parsing) to stop
 * DNS-rebinding (a public name pointing at an internal IP). Set
 * WEBHOOK_ALLOW_PRIVATE=1 to bypass for intentional internal targets (homelab).
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid webhook URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Refusing webhook URL: unsupported scheme ${url.protocol}`);
  }
  if (process.env.WEBHOOK_ALLOW_PRIVATE === '1') return;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  // Resolve ALL addresses; a single private result blocks the request.
  const results = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => {
        throw new Error(`Refusing webhook URL: cannot resolve ${host}`);
      });
  const addrs = (Array.isArray(results) ? results : [results]).map((r) => r.address);
  if (addrs.length === 0) throw new Error(`Refusing webhook URL: ${host} resolved to nothing`);
  for (const addr of addrs) {
    if (isBlocked(addr)) {
      throw new Error(
        `Refusing webhook URL: ${host} resolves to a private/loopback/link-local address (${addr})`,
      );
    }
  }
}
