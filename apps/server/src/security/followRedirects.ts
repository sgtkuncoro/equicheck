import type { Page } from 'playwright';
import { limits } from '../config.js';
import { ServiceError } from '../errors.js';
import { assertScannableUrl } from './urlGuard.js';

const MAX_HOPS = 5;

/**
 * Resolve a redirect chain in Node, validating every hop, and return the URL the
 * browser should actually navigate to.
 *
 * This exists because of a Playwright behaviour that is easy to get wrong, and
 * that was verified by experiment rather than assumed: a `context.route()`
 * handler is invoked for the request the page initiates, but NOT for the hops of
 * a redirect chain. Chromium's network stack follows `3xx` responses internally.
 * So a target answering `302 Location: http://169.254.169.254/` sails past both
 * the entry-point check, which only ever saw the typed URL, and the route
 * handler, which is never called again.
 *
 * Resolving the chain here instead keeps full page fidelity: the browser
 * navigates natively to the final URL, so the document origin and every relative
 * asset path are correct. Rewriting the request inside a route handler would
 * have left the page believing it was still at the pre-redirect URL, breaking
 * relative stylesheets on the very common apex-to-www and http-to-https
 * redirects.
 *
 * Residual risk, stated rather than hidden: a target can serve one redirect to
 * this pre-flight and a different one to Chromium a moment later. That is the
 * same time-of-check/time-of-use class as DNS rebinding. `assertFinalUrl` below
 * closes the disclosure half of it by refusing to return results from a private
 * address; a blind request may still have been made.
 */
export async function resolveSafeUrl(start: URL): Promise<URL> {
  let current = start;

  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(limits.navigationTimeoutMs),
        headers: { 'user-agent': 'EquiCheck/1.0 accessibility scanner' },
      });
    } catch {
      // Unreachable, TLS failure, or timeout. Let Playwright produce the real
      // diagnosis: it reports a far more specific reason than fetch does.
      return current;
    }
    // The body is never read; releasing it stops the socket being held open.
    await response.body?.cancel().catch(() => undefined);

    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!location) return current;

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new ServiceError('INVALID_URL', 'That page redirected to an address that cannot be parsed.');
    }
    // Throws BLOCKED_HOST for a private hop, which is the whole point.
    current = await assertScannableUrl(next.toString());
  }

  throw new ServiceError(
    'TARGET_UNREACHABLE',
    `That address redirected more than ${MAX_HOPS} times, so it was not scanned.`,
  );
}

/**
 * Last line of defence, run after load and before any result is returned.
 *
 * Every frame, not just the main one. `@axe-core/playwright` injects into
 * cross-origin subframes through the CDP and merges their violations into the
 * result, so a frame that redirected into private space would put that
 * document's markup into `violations[].nodes[].html` while `page.url()` stayed
 * innocently public. Frame URLs are read after load, so they are post-redirect.
 *
 * The request was still made. That is the same accepted time-of-check class as
 * DNS rebinding; what this stops is the disclosure.
 */
export async function assertFinalFrames(page: Page): Promise<void> {
  const urls = new Set(page.frames().map((frame) => frame.url()));
  for (const url of urls) {
    if (url === '' || url === 'about:blank' || url.startsWith('blob:') || url.startsWith('data:')) {
      continue;
    }
    await assertScannableUrl(url);
  }
}
