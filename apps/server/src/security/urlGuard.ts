import { promises as dns, type LookupAddress } from 'node:dns';
import net from 'node:net';
import { config } from '../config.js';
import { ServiceError } from '../errors.js';

/**
 * Address ranges a scan target must never resolve to. Blocking these is the
 * single most valuable guardrail in the app: without it, anyone who can reach
 * the portal can use the headless browser as a proxy into the host's private
 * network and into cloud instance metadata.
 */
const BLOCKED_V4 = [
  { cidr: '0.0.0.0/8', why: 'unspecified' },
  { cidr: '10.0.0.0/8', why: 'private' },
  { cidr: '100.64.0.0/10', why: 'carrier-grade NAT' },
  { cidr: '127.0.0.0/8', why: 'loopback' },
  { cidr: '169.254.0.0/16', why: 'link-local, includes cloud metadata at 169.254.169.254' },
  { cidr: '172.16.0.0/12', why: 'private' },
  { cidr: '192.0.0.0/24', why: 'IETF protocol assignments' },
  { cidr: '192.168.0.0/16', why: 'private' },
  { cidr: '198.18.0.0/15', why: 'benchmarking' },
  { cidr: '224.0.0.0/4', why: 'multicast' },
  { cidr: '240.0.0.0/4', why: 'reserved' },
] as const;

const BLOCKED_MESSAGE =
  'That address resolves to a private or internal network, which this scanner refuses to reach.';

function inCidrV4(address: string, cidr: string): boolean {
  const slash = cidr.indexOf('/');
  const bits = Number(cidr.slice(slash + 1));
  const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
  return (toUint32(address) & mask) === (toUint32(cidr.slice(0, slash)) & mask);
}

function toUint32(dotted: string): number {
  const parts = dotted.split('.');
  return (
    ((Number(parts[0]) << 24) | (Number(parts[1]) << 16) | (Number(parts[2]) << 8) | Number(parts[3])) >>> 0
  );
}

/**
 * Split a validated IPv6 literal into its eight 16-bit pieces.
 *
 * Node validates the syntax but exposes no parser, and string matching on IPv6
 * is how the previous version of this file grew a hole: `::ffff:127.0.0.1` is
 * serialised by WHATWG URL parsing as `::ffff:7f00:1`, so a regex written
 * against the dotted form never fired and the `::` compression left the first
 * hextet empty, which defeated the prefix tests too. Numbers do not have
 * spelling variants.
 */
function toHextets(address: string): number[] | null {
  let text = address.toLowerCase();

  // A trailing dotted quad, as in ::ffff:127.0.0.1, becomes two hextets.
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    if ([a, b, c, d].some((part) => part === undefined || part > 255)) return null;
    const hi = ((a as number) << 8) | (b as number);
    const lo = ((c as number) << 8) | (d as number);
    text = `${text.slice(0, dotted.index)}${hi.toString(16)}:${lo.toString(16)}`;
  }

  const [head, tail, extra] = text.split('::');
  if (extra !== undefined) return null;
  const parse = (part: string) => (part === '' ? [] : part.split(':').map((piece) => parseInt(piece, 16)));
  const left = parse(head ?? '');
  const right = tail === undefined ? [] : parse(tail);

  if (tail === undefined) return left.length === 8 ? left : null;
  const gap = 8 - left.length - right.length;
  if (gap < 1) return null;
  return [...left, ...Array<number>(gap).fill(0), ...right];
}

/**
 * True when an address is outside public routable space.
 *
 * IPv4 is a blocklist, because the ranges to refuse are enumerable and the rest
 * of the space is genuinely public. IPv6 is the opposite: an allowlist of global
 * unicast only. Allow-by-omission is what let an IPv4-mapped address through
 * before, and the same shape would have let the next unusual form through too,
 * so anything that is not plainly a public address is refused.
 */
export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    return BLOCKED_V4.some((entry) => inCidrV4(address, entry.cidr));
  }
  if (!net.isIPv6(address)) return false;

  const hextets = toHextets(address);
  // Unparseable means unclassifiable, which means refused.
  if (!hextets) return true;
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets as [
    number, number, number, number, number, number, number, number,
  ];
  const embeddedV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

  // ::ffff:0:0/96, IPv4-mapped. The kernel delivers these to the IPv4 address,
  // so they must be judged as that address.
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) {
    return isPrivateAddress(embeddedV4(h6, h7));
  }
  // 64:ff9b::/96, NAT64. Real on IPv6-only cloud networks, where
  // 64:ff9b::a9fe:a9fe reaches the metadata service through the gateway.
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return isPrivateAddress(embeddedV4(h6, h7));
  }
  // 2002::/16, 6to4. The embedded IPv4 is in the next two hextets.
  if (h0 === 0x2002) {
    return isPrivateAddress(embeddedV4(h1, h2));
  }

  // Everything else: allowed only inside 2000::/3 global unicast. That refuses
  // ::, ::1, fc00::/7, fe80::/10, ff00::/8 and every reserved block without
  // needing to enumerate them.
  return (h0 & 0xe000) !== 0x2000;
}

/**
 * Parse, validate and normalise a user-supplied scan target.
 *
 * Called at request entry, and again by the per-request route handler for every
 * hop Playwright makes, so a redirect into private space is also caught.
 */
export async function assertScannableUrl(raw: unknown): Promise<URL> {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ServiceError('INVALID_URL', 'Enter a web address to scan.');
  }

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ServiceError(
      'INVALID_URL',
      'That is not a valid web address. Include the scheme, for example https://example.com/page.',
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ServiceError(
      'INVALID_URL',
      `Only http:// and https:// addresses can be scanned, not ${url.protocol}`,
    );
  }

  if (config.allowPrivateTargets) return url;

  // Strip the brackets IPv6 literals carry inside a URL host.
  const host = url.hostname.replace(/^\[|\]$/g, '');

  // A literal IP needs no DNS round trip, and must not get one: a lookup of
  // "127.0.0.1" would succeed and tell us nothing new.
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new ServiceError('BLOCKED_HOST', BLOCKED_MESSAGE);
    return url;
  }

  let records: LookupAddress[];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ServiceError(
      'DNS_FAILURE',
      `Could not resolve "${host}". Check the address and try again.`,
    );
  }

  // Every returned record must be public. A hostname with one public and one
  // private A record is a rebinding attempt, not a misconfiguration.
  if (records.some((record) => isPrivateAddress(record.address))) {
    throw new ServiceError('BLOCKED_HOST', BLOCKED_MESSAGE);
  }

  return url;
}
