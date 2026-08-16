/**
 * The HTTP contract between client and server.
 *
 * Imported with `import type` on both sides, so this file never appears in
 * either bundle at runtime and needs no build step of its own.
 */

export type ScanMode = 'url' | 'snippet';

/** axe impact levels, most to least severe. `null` when axe does not assign one. */
export type Impact = 'critical' | 'serious' | 'moderate' | 'minor';

export interface WireNode {
  /** The offending markup. Clamped server-side, see `truncated`. */
  html: string;
  /** CSS selector path to the element, flattened across frame boundaries. */
  target: string;
  /** axe's own human-readable "fix any of the following" prose. Newlines are significant. */
  failureSummary: string | null;
  /** True when `html` was clamped to the server's per-node character limit. */
  truncated: boolean;
}

export interface WireViolation {
  /** axe rule id, e.g. "image-alt". */
  id: string;
  impact: Impact | null;
  /** Short imperative statement of the rule. */
  help: string;
  /** Canonical Deque rule reference. */
  helpUrl: string;
  /** Longer explanation of the rule. */
  description: string;
  /** axe tags, e.g. ["cat.text-alternatives", "wcag2a", "wcag111"]. */
  tags: string[];
  /** Total failing elements axe found, before `nodes` was capped. */
  nodeCount: number;
  /** Failing elements, capped server-side. Compare length against `nodeCount`. */
  nodes: WireNode[];
}

export interface ScanCounts {
  violations: number;
  passes: number;
  incomplete: number;
  inapplicable: number;
}

export interface ScanRequest {
  /** Exactly one of `url` or `html` must be present. */
  url?: string;
  html?: string;
}

export interface ScanResponse {
  scanId: string;
  mode: ScanMode;
  /** The URL scanned, or "Inline HTML snippet". */
  target: string;
  scannedAt: string;
  durationMs: number;
  /** HTTP status the target returned, when there was a real navigation. */
  targetStatus: number | null;
  counts: ScanCounts;
  /** Sorted most to least severe, then by failing-element count. */
  violations: WireViolation[];
  /** Honest caveats about this particular scan. Always render these. */
  warnings: string[];
}

export interface ExplainRequest {
  scanId: string;
  violationId: string;
  nodeIndex: number;
}

export interface ExplainResponse {
  violationId: string;
  nodeIndex: number;
  /** Markdown. Render with an allowlist, never as raw HTML. */
  explanation: string;
  model: string;
}

/** Machine-stable failure codes. The client maps these to its own copy. */
export type ErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_URL'
  | 'BLOCKED_HOST'
  | 'SNIPPET_TOO_LARGE'
  | 'DNS_FAILURE'
  | 'TLS_ERROR'
  | 'TARGET_UNREACHABLE'
  | 'SCAN_TIMEOUT'
  | 'PAGE_CRASHED'
  | 'BROWSER_MISSING'
  | 'TOO_MANY_SCANS'
  | 'RATE_LIMITED'
  | 'SCAN_NOT_FOUND'
  | 'LLM_CONFIG'
  | 'LLM_RATE_LIMIT'
  | 'LLM_FAILED'
  | 'INTERNAL';

export interface ApiErrorBody {
  code: ErrorCode;
  /** Safe to render directly to the user. Never contains secrets or stack traces. */
  message: string;
}

export interface HealthResponse {
  ok: boolean;
  /** Whether "Get help" will work. Nothing else about the server's posture. */
  llmConfigured: boolean;
}
