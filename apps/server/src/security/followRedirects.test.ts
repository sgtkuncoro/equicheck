import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression cover for a real hole found during smoke testing.
 *
 * Playwright does NOT invoke a `context.route()` handler for the hops of a
 * redirect chain, so a route-based guard cannot see a `302` into private space.
 * These tests pin the replacement: the chain is resolved in Node and every hop
 * is validated before the browser navigates anywhere.
 *
 * The address classifier itself is covered exhaustively in urlGuard.test.ts. Here
 * it is stubbed, so what is under test is purely the wiring: does every hop get
 * validated, and does a rejected hop stop the whole scan?
 */
describe('resolveSafeUrl', () => {
  const servers: http.Server[] = [];

  // Promise.withResolvers is Node 22+; this project targets Node 20, so the
  // executor form is the only option here.
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
    );
    vi.doUnmock('./urlGuard.js');
    vi.resetModules();
  });

  async function serve(handler: http.RequestListener): Promise<string> {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', () => ready()));
    // listen() has resolved, so address() is an AddressInfo rather than a pipe
    // name or null. Not expressible through the Node types any other way.
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  // Stands in for the real classifier: anything link-local is refused, the rest
  // is allowed, so a loopback test server can play the part of a public host.
  async function loadWithStubbedGuard() {
    vi.resetModules();
    vi.doMock('./urlGuard.js', () => ({
      assertScannableUrl: async (raw: string) => {
        if (raw.includes('169.254.')) {
          const { ServiceError } = await import('../errors.js');
          throw new ServiceError('BLOCKED_HOST', 'blocked');
        }
        return new URL(raw);
      },
    }));
    return import('./followRedirects.js');
  }

  it('refuses a redirect into a private address instead of following it', async () => {
    const origin = await serve((_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    });
    const { resolveSafeUrl } = await loadWithStubbedGuard();
    await expect(resolveSafeUrl(new URL(origin))).rejects.toMatchObject({ code: 'BLOCKED_HOST' });
  });

  it('follows a chain of allowed redirects and returns the final address', async () => {
    let base = '';
    base = await serve((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: '/middle' });
        res.end();
        return;
      }
      if (req.url === '/middle') {
        res.writeHead(301, { location: `${base}/final` });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>t</title>');
    });

    const { resolveSafeUrl } = await loadWithStubbedGuard();
    const resolved = await resolveSafeUrl(new URL(`${base}/start`));
    expect(resolved.toString()).toBe(`${base}/final`);
  });

  it('resolves a relative Location header against the current hop', async () => {
    const base = await serve((req, res) => {
      if (req.url === '/a/b') {
        res.writeHead(302, { location: 'c' });
        res.end();
        return;
      }
      res.writeHead(200);
      res.end('ok');
    });
    const { resolveSafeUrl } = await loadWithStubbedGuard();
    const resolved = await resolveSafeUrl(new URL(`${base}/a/b`));
    expect(resolved.toString()).toBe(`${base}/a/c`);
  });

  it('gives up on a redirect loop rather than spinning', async () => {
    const base = await serve((_req, res) => {
      res.writeHead(302, { location: '/loop' });
      res.end();
    });
    const { resolveSafeUrl } = await loadWithStubbedGuard();
    await expect(resolveSafeUrl(new URL(`${base}/loop`))).rejects.toMatchObject({
      code: 'TARGET_UNREACHABLE',
    });
  });

  it('leaves an unreachable target to Playwright, which diagnoses it better', async () => {
    const { resolveSafeUrl } = await loadWithStubbedGuard();
    // Port 1 on loopback refuses immediately; fetch throws and the original URL
    // comes back untouched so navigation can produce the specific error.
    const resolved = await resolveSafeUrl(new URL('http://127.0.0.1:1/'));
    expect(resolved.toString()).toBe('http://127.0.0.1:1/');
  });

  it('does not treat a 200 as a redirect', async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>t</title>');
    });
    const { resolveSafeUrl } = await loadWithStubbedGuard();
    expect((await resolveSafeUrl(new URL(`${base}/`))).toString()).toBe(`${base}/`);
  });
});
