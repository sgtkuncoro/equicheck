import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// The .env lives at the repo root, not in apps/server/, so a reviewer only has one
// file to fill in. Resolved from this module rather than cwd so `pnpm start`
// works from either the root or apps/server/.
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

function positiveInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const rawAllowPrivate = process.env.ALLOW_PRIVATE_TARGETS;

export const config = {
  port: positiveInt('PORT', 3001),
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() ?? '',
  geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
  geminiFallbackModel: process.env.GEMINI_FALLBACK_MODEL?.trim() || 'gemini-2.0-flash',
  allowPrivateTargets: rawAllowPrivate === 'true' || rawAllowPrivate === '1',
  maxConcurrentScans: positiveInt('MAX_CONCURRENT_SCANS', 3),
  /** Serve the built client from Express. Dev uses the Vite server and its /api proxy instead. */
  serveClient: process.env.NODE_ENV === 'production',
} as const;

/** Hard limits. Deliberately constants, not env knobs: they are correctness, not configuration. */
export const limits = {
  /** Largest HTML snippet accepted, in characters. */
  maxSnippetChars: 200_000,
  /** Per-node markup clamp. Keeps both the payload and the LLM prompt bounded. */
  maxNodeHtmlChars: 2_000,
  /** Failing elements rendered per rule. The full count is reported separately. */
  maxNodesPerViolation: 25,
  /** Playwright navigation budget. */
  navigationTimeoutMs: 20_000,
  /** Failing-element selector clamp. Attacker-influenced and it reaches the prompt. */
  maxSelectorChars: 300,
  /** Scan target string clamp, for the same reason. */
  maxTargetChars: 512,
  /** Cached scans retained. Bounds memory independently of the TTL. */
  maxCachedScans: 200,
  /** Cadence of the scan-store expiry sweep. */
  storeSweepIntervalMs: 60_000,
  /** Bounded, non-fatal wait for SPA hydration after `load`. */
  settleTimeoutMs: 3_000,
  /** Whole-request budget for POST /api/scan. */
  scanRequestTimeoutMs: 40_000,
  /** Gemini call budget. The SDK's own default is unverified, so we impose one. */
  llmTimeoutMs: 20_000,
  /** How long a scan stays explainable. */
  scanTtlMs: 15 * 60_000,
  /** Requests per window per IP, across both endpoints. */
  rateLimitMax: 30,
  rateLimitWindowMs: 60_000,
} as const;

export const llmConfigured = config.geminiApiKey.length > 0;
