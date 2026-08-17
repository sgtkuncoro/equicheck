import { fileURLToPath } from 'node:url';
import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import { config, limits, llmConfigured } from './config.js';
import { ServiceError } from './errors.js';
import { rateLimit } from './http/rateLimit.js';
import { explainViolation } from './llm/gemini.js';
import { closeBrowser } from './scan/browser.js';
import { countResults, mapViolations } from './scan/mapResults.js';
import { scanSnippet, scanUrl } from './scan/runScan.js';
import { findExplainTarget, putScan } from './scan/scanStore.js';
import { assertScannableUrl } from './security/urlGuard.js';
import type {
  ApiErrorBody,
  ExplainRequest,
  ExplainResponse,
  HealthResponse,
  ScanRequest,
  ScanResponse,
} from 'shared/wire';

const app = express();
app.disable('x-powered-by');
// No proxy in front: in production this process serves the client itself. So
// req.ip is the socket address, which is what the limiter wants. Trusting
// X-Forwarded-For here would let any client forge its own bucket. Put nginx in
// front and this needs revisiting.
app.set('trust proxy', false);
// Limiter first, so a throttled client does not get to make the server parse a
// quarter-megabyte body. The cap covers the 200KB snippet limit with room for
// JSON escaping and nothing more.
app.use('/api', rateLimit);
app.use(express.json({ limit: '256kb' }));

/**
 * How many scans may run at once.
 *
 * Each scan holds a BrowserContext and a page for up to 40 seconds, so the real
 * ceiling is host memory. A counter plus a 429 is the whole mechanism: no queue,
 * no job runner, nothing to operate.
 */
let scansInFlight = 0;

// Deliberately minimal. An earlier version reported whether the private-address
// guard was switched off, which told an unauthenticated caller whether probing
// was worth their time.
app.get('/api/health', (_req, res: Response<HealthResponse>) => {
  res.json({ ok: true, llmConfigured });
});

app.post('/api/scan', async (req: Request<unknown, unknown, ScanRequest>, res, next) => {
  const { url, html } = req.body ?? {};
  const hasUrl = typeof url === 'string' && url.trim() !== '';
  const hasHtml = typeof html === 'string' && html.trim() !== '';

  if (hasUrl === hasHtml) {
    next(
      new ServiceError(
        'INVALID_INPUT',
        hasUrl
          ? 'Send either a URL or an HTML snippet, not both.'
          : 'Send a URL to scan, or an HTML snippet to check.',
      ),
    );
    return;
  }

  if (scansInFlight >= config.maxConcurrentScans) {
    next(
      new ServiceError(
        'TOO_MANY_SCANS',
        `This server runs ${config.maxConcurrentScans} scans at a time and is currently busy. Try again in a moment.`,
      ),
    );
    return;
  }

  scansInFlight += 1;
  const startedAt = Date.now();
  try {
    // The whole-scan deadline lives in runScan's withContext, not here. Racing
    // it at this layer answered the caller but left the losing scan running with
    // its BrowserContext open, while this handler's `finally` had already freed
    // the concurrency slot.
    const outcome = hasUrl
      ? await scanUrl(await assertScannableUrl(url))
      : await scanSnippet(html as string);

    const response: ScanResponse = putScan({
      mode: hasUrl ? 'url' : 'snippet',
      target: hasUrl ? (url as string).trim() : 'Inline HTML snippet',
      scannedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      targetStatus: outcome.status,
      counts: countResults(outcome.results),
      violations: mapViolations(outcome.results),
      warnings: outcome.warnings,
    });
    res.json(response);
  } catch (err) {
    next(err);
  } finally {
    scansInFlight -= 1;
  }
});

app.post('/api/explain', async (req: Request<unknown, unknown, ExplainRequest>, res, next) => {
  const { scanId, violationId, nodeIndex } = req.body ?? {};
  if (typeof scanId !== 'string' || typeof violationId !== 'string' || !Number.isInteger(nodeIndex)) {
    next(new ServiceError('INVALID_INPUT', 'A scan id, a violation id and an element index are required.'));
    return;
  }

  const target = findExplainTarget(scanId, violationId, nodeIndex);
  if (!target) {
    next(
      new ServiceError(
        'SCAN_NOT_FOUND',
        'That scan has expired or no longer has this element. Run the scan again.',
      ),
    );
    return;
  }

  try {
    const explanation = await explainViolation(target);
    const response: ExplainResponse = {
      violationId,
      nodeIndex,
      explanation: explanation.markdown,
      model: explanation.model,
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

// In production the API and the built client share one origin, so there is no
// CORS story to get wrong and no second thing to deploy.
if (config.serveClient) {
  const clientDist = new URL('../../client/dist/', import.meta.url);
  // fileURLToPath, not URL.pathname: pathname keeps percent-escapes, so a
  // checkout under a path with a space would resolve to a directory that does
  // not exist.
  app.use(express.static(fileURLToPath(clientDist)));
  app.get('*splat', (_req, res) => {
    res.sendFile(fileURLToPath(new URL('index.html', clientDist)));
  });
}

/** express.json rejections carry a `type`; they are client errors, not server bugs. */
const BODY_ERRORS: Record<string, ApiErrorBody> = {
  'entity.parse.failed': { code: 'INVALID_INPUT', message: 'The request body is not valid JSON.' },
  'entity.too.large': {
    code: 'SNIPPET_TOO_LARGE',
    message: `That request is too large. The snippet limit is ${limits.maxSnippetChars / 1000}KB.`,
  },
};

const handleErrors: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ServiceError) {
    if (err.code === 'INTERNAL') console.error('[equicheck]', err.message, err.cause);
    res.status(err.status).json(err.body);
    return;
  }

  const type = err instanceof Error && 'type' in err ? String(err.type) : '';
  const known = BODY_ERRORS[type];
  if (known) {
    res.status(known.code === 'INVALID_INPUT' ? 400 : 413).json(known);
    return;
  }

  console.error('[equicheck] unhandled', err);
  res.status(500).json({ code: 'INTERNAL', message: 'Something went wrong on the server.' });
};
app.use(handleErrors);

const server = app.listen(config.port, () => {
  console.log(`[equicheck] api listening on http://localhost:${config.port}`);
  if (!llmConfigured) {
    console.warn(
      '[equicheck] GEMINI_API_KEY is not set. Scanning works; "Get help" will return a configuration error until you set it in .env and restart.',
    );
  }
  if (config.allowPrivateTargets) {
    console.warn(
      '[equicheck] ALLOW_PRIVATE_TARGETS=true. Private and loopback addresses are scannable. Never run this way on a shared host.',
    );
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void closeBrowser().then(() => process.exit(0));
    });
  });
}
