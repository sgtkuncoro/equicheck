import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

// Must be set before the module graph loads, because config.ts reads the
// environment once at import time. The fixture server is on loopback, which the
// guard refuses by design, so this file is the one place that opts out. It is why
// the import below is dynamic: a static import would bind config first.
process.env.ALLOW_PRIVATE_TARGETS = 'true';

const { scanUrl } = await import('./runScan.js');
const { mapViolations } = await import('./mapResults.js');
const { closeBrowser } = await import('./browser.js');

/**
 * The one test that drives a real navigation: Chromium launches, loads a page
 * over HTTP, axe is injected and runs.
 *
 * Offline and deterministic, because the fixture is served from this process. An
 * assertion against a real third-party site would break whenever that site
 * changed its markup, which is a test that fails for reasons unrelated to this
 * code.
 */
describe('url scanning', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
    );
  });

  afterAll(async () => {
    await closeBrowser();
  });

  async function serve(handler: http.RequestListener): Promise<string> {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', () => ready()));
    // listen() has resolved, so address() is an AddressInfo, not null or a pipe.
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  it('navigates, runs axe, and reports the violations the page really has', async () => {
    const origin = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        '<!doctype html><html lang="en"><head><title>Fixture</title></head><body><main><img src="a.png"><button></button></main></body></html>',
      );
    });

    const outcome = await scanUrl(new URL(origin));
    const ids = mapViolations(outcome.results).map((violation) => violation.id);

    expect(outcome.status).toBe(200);
    expect(ids).toContain('image-alt');
    expect(ids).toContain('button-name');
  }, 60_000);

  it('scans what a 404 actually served, and warns that it did', async () => {
    const origin = await serve((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<!doctype html><html lang="en"><head><title>Not found</title></head><body><img src="x.png"></body></html>');
    });

    const outcome = await scanUrl(new URL(origin));
    expect(outcome.status).toBe(404);
    expect(outcome.warnings.join(' ')).toContain('HTTP 404');
    // A 404 page is still a page with a DOM, so it is scanned rather than refused.
    expect(mapViolations(outcome.results).map((v) => v.id)).toContain('image-alt');
  }, 60_000);

  it('follows a redirect and says which address was actually scanned', async () => {
    let origin = '';
    origin = await serve((req, res) => {
      if (req.url === '/from') {
        res.writeHead(302, { location: `${origin}/to` });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html lang="en"><head><title>Destination</title></head><body><img src="a.png"></body></html>');
    });

    const outcome = await scanUrl(new URL(`${origin}/from`));
    expect(outcome.warnings.join(' ')).toContain(`${origin}/to`);
    expect(mapViolations(outcome.results).map((v) => v.id)).toContain('image-alt');
  }, 60_000);
});
