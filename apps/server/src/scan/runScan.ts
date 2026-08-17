import { AxeBuilder } from '@axe-core/playwright';
import type { AxeResults } from 'axe-core';
import type { BrowserContext, Page, Route } from 'playwright';
import { limits } from '../config.js';
import { ServiceError } from '../errors.js';
import { assertFinalFrames, resolveSafeUrl } from '../security/followRedirects.js';
import { assertScannableUrl } from '../security/urlGuard.js';
import { getBrowser } from './browser.js';

/**
 * WCAG 2.2 AA coverage requires the whole cumulative list. axe tags rules with
 * the WCAG version that introduced them, so filtering on `wcag22aa` alone would
 * silently drop every WCAG 2.0 and 2.1 rule, which is most of them.
 */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

export interface ScanOutcome {
  results: AxeResults;
  /** HTTP status of the main document, or null in snippet mode. */
  status: number | null;
  warnings: string[];
}
/**
 * Abort any document request whose URL is not scannable.
 *
 * Registered for every context, including snippet mode. Snippet mode needs it
 * most: the caller supplies the document body directly, so
 * `<iframe src="http://192.168.1.1/admin/">` needs no redirect and no race to
 * reach a private service, and axe injects into cross-origin frames, so that
 * frame's markup would come back inside `violations[].nodes[].html`.
 *
 * This handler cannot see redirect hops: Playwright does not re-invoke a route
 * handler for them, verified by experiment. Top-level redirects are handled by
 * `resolveSafeUrl` before navigation, and `assertFinalFrames` re-checks every
 * frame afterwards.
 *
 * Only `document` requests are checked. A sub-resource cannot be read back out,
 * so it is not a disclosure path, and validating every image would add a DNS
 * lookup per asset.
 */
async function guardDocumentRequests(context: BrowserContext): Promise<void> {
  await context.route('**/*', async (route: Route) => {
    if (route.request().resourceType() !== 'document') {
      await route.continue();
      return;
    }
    try {
      await assertScannableUrl(route.request().url());
      await route.continue();
    } catch {
      await route.abort('blockedbyclient');
    }
  });
}

/**
 * Own the whole-scan deadline here, not in the route handler.
 *
 * Racing the deadline at the HTTP layer would answer the caller but leave the
 * losing scan running: `finally` never fires for a promise nobody settles, so
 * the context, the page and a pegged renderer would leak while the concurrency
 * slot was already freed. That is reachable, not theoretical, because
 * `AxeBuilder.analyze` runs `page.evaluate` with no timeout of its own, so a
 * page whose script busy-loops after `load` hangs forever. Racing inside the
 * `try` means the `finally` below runs on timeout, and `context.close()` kills
 * the page target, which rejects the hung evaluate.
 */
async function withContext<T>(run: (context: BrowserContext) => Promise<T>): Promise<T> {
  const browser = await getBrowser();
  // bypassCSP matters: a target serving `script-src 'self'` would otherwise
  // block the axe runtime AxeBuilder injects, breaking the scan with no obvious
  // cause. Safe here because the injected script is our own analysis code and
  // it only ever runs in a throwaway headless tab.
  const context = await browser.newContext({
    bypassCSP: true,
    ignoreHTTPSErrors: false,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 EquiCheck/1.0',
  });
  // Every context, no exceptions. Registering this per call site is how snippet
  // mode ended up unguarded.
  await guardDocumentRequests(context);

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new ServiceError(
          'SCAN_TIMEOUT',
          `The scan did not finish within ${limits.scanRequestTimeoutMs / 1000} seconds.`,
        ),
      );
    }, limits.scanRequestTimeoutMs);
    timer.unref();
  });

  try {
    return await Promise.race([run(context), deadline]);
  } finally {
    clearTimeout(timer);
    await context.close().catch(() => undefined);
  }
}

function navigationError(err: unknown): ServiceError {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new ServiceError(
      'SCAN_TIMEOUT',
      `The page did not finish loading within ${limits.navigationTimeoutMs / 1000} seconds.`,
    );
  }
  if (message.includes('ERR_NAME_NOT_RESOLVED')) {
    return new ServiceError('DNS_FAILURE', 'Could not resolve that domain. Check the address.');
  }
  if (message.includes('ERR_CERT') || message.includes('ERR_SSL')) {
    return new ServiceError(
      'TLS_ERROR',
      "This site's TLS certificate could not be verified, so it was not scanned.",
    );
  }
  if (message.includes('ERR_BLOCKED_BY_CLIENT')) {
    return new ServiceError(
      'BLOCKED_HOST',
      'That page redirected to a private or internal address, so the scan was stopped.',
    );
  }
  // Match Playwright's actual phrase. A bare 'crash' would misfire on any URL
  // containing the word, because Playwright embeds the target URL in the
  // message: scanning /crash-course on a refused connection would report a
  // renderer crash.
  if (message.includes('because page crashed') || message.includes('Page crashed')) {
    return new ServiceError('PAGE_CRASHED', 'The page crashed while it was being scanned.');
  }
  // Our browser died, not their site. Do not blame the target for this.
  if (message.includes('has been closed') || message.includes('Target closed')) {
    return new ServiceError('INTERNAL', 'The scanning browser stopped unexpectedly. Try again.', err);
  }
  if (message.includes('ERR_CONNECTION') || message.includes('ERR_ABORTED')) {
    return new ServiceError('TARGET_UNREACHABLE', 'Could not connect to that address.');
  }
  return new ServiceError('TARGET_UNREACHABLE', 'The page could not be loaded for scanning.', err);
}

export async function scanUrl(requested: URL): Promise<ScanOutcome> {
  // Resolve the redirect chain before the browser is involved, so a hop into
  // private space is refused rather than followed. See followRedirects.ts.
  const url = await resolveSafeUrl(requested);

  return withContext(async (context) => {
    const page = await context.newPage();
    const warnings: string[] = [];

    let status: number | null = null;
    try {
      // `load` rather than `domcontentloaded`, because axe's colour-contrast
      // rule reads computed styles and a client-rendered page has barely any
      // DOM at domcontentloaded. Not `networkidle`, because real pages with
      // analytics beacons, ad frames or websockets never go idle, and hanging
      // every scan is worse than a marginally less complete one.
      const response = await page.goto(url.toString(), {
        waitUntil: 'load',
        timeout: limits.navigationTimeoutMs,
      });
      status = response?.status() ?? null;
      // Bounded extra window for SPA hydration. Never fatal.
      await page
        .waitForLoadState('networkidle', { timeout: limits.settleTimeoutMs })
        .catch(() => undefined);
    } catch (err) {
      throw navigationError(err);
    }

    // Nothing is returned from a private address, whatever route got us there,
    // and that includes subframes. axe injects into cross-origin frames through
    // the CDP, so a frame that redirected into private space would otherwise
    // have its markup merged into the results while page.url() stayed public.
    await assertFinalFrames(page);

    if (url.toString() !== requested.toString()) {
      warnings.push(`${requested.toString()} redirected to ${url.toString()}, which is what was scanned.`);
    }
    if (status !== null && status >= 400) {
      warnings.push(
        `The page returned HTTP ${status}. What follows is a scan of the error page that was served, not of the page you may have expected.`,
      );
    }

    const results = await analyze(page);
    return { results, status, warnings };
  });
}

export async function scanSnippet(html: string): Promise<ScanOutcome> {
  if (html.length > limits.maxSnippetChars) {
    throw new ServiceError(
      'SNIPPET_TOO_LARGE',
      `That snippet is ${Math.round(html.length / 1000)}KB. The limit is ${limits.maxSnippetChars / 1000}KB.`,
    );
  }

  return withContext(async (context) => {
    const page = await context.newPage();
    try {
      // setContent rather than a data: URL: no length ceiling, no base64
      // overhead, and the opaque-origin limitation is identical either way.
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: limits.navigationTimeoutMs });
    } catch (err) {
      throw navigationError(err);
    }

    // A snippet can embed an absolute iframe src, so the same frame check the
    // URL path does is needed here too.
    await assertFinalFrames(page);

    const results = await analyze(page);
    return {
      results,
      status: null,
      warnings: [
        'Snippet mode renders your markup with no base URL, so relative stylesheet and asset paths such as href="/app.css" do not load. Rules that depend on computed style, colour-contrast above all, can therefore be wrong in both directions. Use absolute URLs in the snippet, or scan a live page, when contrast matters.',
      ],
    };
  });
}

async function analyze(page: Page): Promise<AxeResults> {
  try {
    return await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  } catch (err) {
    throw new ServiceError(
      'INTERNAL',
      'The accessibility engine could not run against that page.',
      err,
    );
  }
}
