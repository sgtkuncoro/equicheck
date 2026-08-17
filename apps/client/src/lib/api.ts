import type {
  ApiErrorBody,
  ErrorCode,
  ExplainRequest,
  ExplainResponse,
  ScanRequest,
  ScanResponse,
} from 'shared/wire';

/** Carries the server's machine code so callers can react to it without string matching on prose. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK' | 'ABORTED',
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function post<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    if (signal.aborted) throw new ApiError('ABORTED', 'Cancelled.');
    throw new ApiError(
      'NETWORK',
      'Could not reach the EquiCheck server. Check that it is running on port 3001.',
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  // An abort can land after the headers arrive but before the body finishes, and
  // a large violation payload over a slow link makes that window real. Without
  // this check the caller would get a successful null and render nothing at all:
  // no results, no error, no explanation.
  if (signal.aborted) throw new ApiError('ABORTED', 'Cancelled.');

  if (response.ok) {
    if (payload === null) {
      throw new ApiError('INTERNAL', 'The server sent a response that could not be read.');
    }
    return payload as T;
  }

  const error = payload as ApiErrorBody | null;
  throw new ApiError(
    error?.code ?? 'INTERNAL',
    error?.message ?? `The server responded with HTTP ${response.status}.`,
  );
}

export function requestScan(body: ScanRequest, signal: AbortSignal): Promise<ScanResponse> {
  return post<ScanResponse>('/api/scan', body, signal);
}

export function requestExplanation(
  body: ExplainRequest,
  signal: AbortSignal,
): Promise<ExplainResponse> {
  return post<ExplainResponse>('/api/explain', body, signal);
}
