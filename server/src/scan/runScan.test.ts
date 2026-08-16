import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closeBrowser } from './browser.js';
import { mapViolations } from './mapResults.js';
import { scanSnippet } from './runScan.js';

/**
 * Snippet-mode integration, with the private-address guard ON, which is the
 * default the suite pins in vitest.config.ts.
 *
 * The URL-mode equivalent needs the guard off, since its fixture is on loopback,
 * so it lives in runScanUrl.test.ts. Splitting the files is what lets each run
 * against the configuration it is actually testing.
 */
describe('snippet scanning', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
    );
  });

  afterAll(async () => {
    await closeBrowser();
  });

  async function serve(body: string): Promise<string> {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(body);
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', () => ready()));
    // listen() has resolved, so address() is an AddressInfo, not null or a pipe.
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  it('finds the violations the markup really has, through a real browser and a real axe run', async () => {
    const outcome = await scanSnippet(
      '<html lang="en"><head><title>t</title></head><body><main><img src="a.png"><button></button></main></body></html>',
    );
    const ids = mapViolations(outcome.results).map((violation) => violation.id);
    expect(ids).toContain('image-alt');
    expect(ids).toContain('button-name');
  }, 60_000);

  it('says out loud that contrast may be wrong without a base URL', async () => {
    const outcome = await scanSnippet('<html lang="en"><head><title>t</title></head><body></body></html>');
    expect(outcome.warnings.join(' ')).toMatch(/no base URL/i);
  }, 60_000);

  /**
   * Regression cover for a confirmed data-disclosure defect.
   *
   * `@axe-core/playwright` injects into cross-origin subframes through the CDP
   * and merges their violations, so while snippet mode registered no request
   * guard an `<iframe>` was a read primitive against any HTTP service the server
   * could reach: the private document's markup came back inside
   * `violations[].nodes[].html`. Confirmed at the time by running the identical
   * request with the guard disabled, which returned image-alt and link-name
   * carrying the internal markup.
   */
  it('refuses a private iframe and leaks none of its markup', async () => {
    const internal = await serve(
      '<!doctype html><html lang="en"><head><title>Internal</title></head><body><img src="topology-diagram.png"><a href="/rotate-keys"></a></body></html>',
    );
    const outcome = await scanSnippet(
      `<html lang="en"><head><title>t</title></head><body><iframe src="${internal}/" title="f"></iframe></body></html>`,
    );

    const violations = mapViolations(outcome.results);
    const serialised = JSON.stringify(violations);
    expect(serialised).not.toContain('topology-diagram');
    expect(serialised).not.toContain('rotate-keys');
    // The frame contributes nothing at all, rather than contributing findings
    // with the markup stripped: the request was aborted before it was made.
    expect(violations.map((v) => v.id)).not.toContain('link-name');
  }, 60_000);
});
