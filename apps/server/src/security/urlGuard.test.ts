import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertScannableUrl, isPrivateAddress } from './urlGuard.js';

// assertScannableUrl is exercised through a DNS mock in the second block; the
// address classifier is pure and gets the exhaustive table, because a hole here
// is the difference between a scanner and an open proxy into a private network.
describe('isPrivateAddress', () => {
  it.each([
    '0.0.0.0',
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.0.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.1.2.3',
    // The forms that actually reach this function, and that a regex written
    // against the dotted spelling missed. WHATWG URL parsing serialises
    // http://[::ffff:127.0.0.1]/ to [::ffff:7f00:1], and a AAAA record can
    // return the hex form directly, so these were a complete guard bypass.
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '::ffff:a00:1',
    '::ffff:c0a8:1',
    '0:0:0:0:0:ffff:7f00:1',
    // NAT64: reaches the metadata service through the gateway on IPv6-only nets.
    '64:ff9b::a9fe:a9fe',
    '64:ff9b::7f00:1',
    // 6to4 wrapping a private address.
    '2002:a9fe:a9fe::1',
    '2002:7f00:1::1',
    // Outside 2000::/3 global unicast, so refused by default rather than by
    // enumeration.
    '4000::1',
    '100::1',
    'fec0::1',
  ])('blocks %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    '1.1.1.1',
    '8.8.8.8',
    '93.184.216.34',
    '172.32.0.1',
    '171.16.0.1',
    '192.167.255.255',
    '169.253.0.1',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '2a00:1450:4001:800::200e',
    // IPv4-mapped, but mapping a genuinely public address.
    '::ffff:1.1.1.1',
    '::ffff:101:101',
    // 6to4 wrapping a public address.
    '2002:0808:0808::1',
    // Inside 2000::/3, so allowed. Documentation-only ranges route nowhere, and
    // enumerating them would buy nothing.
    '3fff::1',
  ])('allows %s', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it('classifies every IPv6 spelling of one address identically', () => {
    const spellings = ['::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:a9fe:a9fe'];
    expect(spellings.map(isPrivateAddress)).toEqual([true, true, true]);
  });
});

describe('assertScannableUrl', () => {
  // node:dns is bound when the module loads, so a case that needs a different
  // resolver has to re-import through vi.doMock. The literal-address cases
  // never reach DNS and use the static import.
  async function withLookup(
    lookup: () => Promise<{ address: string; family: number }[]>,
  ): Promise<typeof assertScannableUrl> {
    vi.resetModules();
    vi.doMock('node:dns', () => ({ promises: { lookup } }));
    return (await import('./urlGuard.js')).assertScannableUrl;
  }

  afterEach(() => {
    vi.doUnmock('node:dns');
    vi.resetModules();
  });

  it.each([
    '',
    '   ',
    'not a url',
    'example.com',
    'ftp://example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<b>hi</b>',
  ])('rejects %j as INVALID_URL', async (input) => {
    await expect(assertScannableUrl(input)).rejects.toMatchObject({ code: 'INVALID_URL' });
  });

  it.each([
    'http://localhost:5173/',
    'http://127.0.0.1/',
    // Decimal-encoded 127.0.0.1. WHATWG URL parsing normalises this to a dotted
    // quad, which is why a string blocklist would have missed it.
    'http://2130706433/',
    'http://[::1]/',
    'https://169.254.169.254/latest/meta-data/',
    'http://192.168.0.1/admin',
    'http://10.1.2.3:8080/',
  ])('blocks the literal private address %s', async (input) => {
    await expect(assertScannableUrl(input)).rejects.toMatchObject({ code: 'BLOCKED_HOST' });
  });

  it('blocks a hostname that resolves to a private address', async () => {
    const guard = await withLookup(async () => [{ address: '10.0.0.7', family: 4 }]);
    await expect(guard('https://rebind.example.com/')).rejects.toMatchObject({
      code: 'BLOCKED_HOST',
    });
  });

  it('blocks when only one of several records is private', async () => {
    const guard = await withLookup(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(guard('https://split.example.com/')).rejects.toMatchObject({
      code: 'BLOCKED_HOST',
    });
  });

  it('allows a public hostname and preserves the path and query', async () => {
    const guard = await withLookup(async () => [{ address: '93.184.216.34', family: 4 }]);
    const url = await guard('https://example.com/a/b?c=1');
    expect(url.toString()).toBe('https://example.com/a/b?c=1');
  });

  it('reports an unresolvable host as DNS_FAILURE, not as blocked', async () => {
    const guard = await withLookup(() => Promise.reject(new Error('ENOTFOUND')));
    await expect(guard('https://nope.invalid/')).rejects.toMatchObject({ code: 'DNS_FAILURE' });
  });
});
