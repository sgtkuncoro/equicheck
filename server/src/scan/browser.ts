import { chromium, type Browser } from 'playwright';
import { ServiceError } from '../errors.js';

/**
 * One Chromium process, reused across scans, with a fresh BrowserContext per
 * request.
 *
 * Launching per request costs 1-2s every time and, under concurrent load,
 * spawns one Chromium per in-flight scan until the host runs out of file
 * descriptors. A singleton pays that cost once; contexts already provide the
 * isolation (separate cookie jar, cache and storage) that separate processes
 * would have given us.
 *
 * The tradeoff is that a crash takes the process down for everyone, so the
 * cached promise is cleared on `disconnected` and the next caller relaunches.
 */
let browserPromise: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({ headless: true, args: ['--disable-dev-shm-usage'] })
      .then((browser) => {
        browser.on('disconnected', () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((err: unknown) => {
        browserPromise = null;
        const message = err instanceof Error ? err.message : '';
        if (message.includes("Executable doesn't exist") || message.includes('playwright install')) {
          throw new ServiceError(
            'BROWSER_MISSING',
            "Playwright's Chromium is not installed. Run `pnpm setup:browser` in the project root, then try again.",
          );
        }
        throw new ServiceError('INTERNAL', 'Could not start the headless browser.', err);
      });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  await pending.then((browser) => browser.close()).catch(() => undefined);
}
