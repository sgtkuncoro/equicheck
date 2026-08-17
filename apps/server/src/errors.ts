import type { ApiErrorBody, ErrorCode } from 'shared/wire';

const STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  INVALID_URL: 400,
  BLOCKED_HOST: 400,
  SNIPPET_TOO_LARGE: 413,
  DNS_FAILURE: 422,
  TLS_ERROR: 422,
  TARGET_UNREACHABLE: 422,
  SCAN_TIMEOUT: 504,
  PAGE_CRASHED: 502,
  BROWSER_MISSING: 503,
  TOO_MANY_SCANS: 429,
  RATE_LIMITED: 429,
  SCAN_NOT_FOUND: 404,
  LLM_CONFIG: 500,
  LLM_RATE_LIMIT: 429,
  LLM_FAILED: 502,
  INTERNAL: 500,
};

/**
 * An error whose message is safe to show a user verbatim.
 *
 * Anything thrown that is not a ServiceError is treated as a bug: it is logged
 * server-side and reported to the client as a generic INTERNAL, so stack traces
 * and provider messages never leak.
 */
export class ServiceError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ServiceError';
  }

  get status(): number {
    return STATUS[this.code];
  }

  get body(): ApiErrorBody {
    return { code: this.code, message: this.message };
  }
}
