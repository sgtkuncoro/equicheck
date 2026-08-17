import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScanRequest, ScanResponse } from 'shared/wire';
import { ApiError, requestScan } from '../lib/api.ts';

export type ScanState =
  | { status: 'idle' }
  | { status: 'pending'; target: string }
  | { status: 'ok'; data: ScanResponse }
  | { status: 'error'; code: string; message: string }
  | { status: 'cancelled' };

/**
 * Client ceiling, above the server's 40s budget so its structured error usually
 * wins the race and the user gets the specific reason rather than this one.
 */
const CLIENT_TIMEOUT_MS = 45_000;

export interface UseScan {
  state: ScanState;
  start: (body: ScanRequest, target: string) => void;
  cancel: () => void;
}

export function useScan(): UseScan {
  const [state, setState] = useState<ScanState>({ status: 'idle' });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState({ status: 'cancelled' });
  }, []);

  const start = useCallback((body: ScanRequest, target: string) => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    const timer = setTimeout(() => next.abort(), CLIENT_TIMEOUT_MS);

    setState({ status: 'pending', target });
    requestScan(body, next.signal)
      .then((data) => {
        // A superseded request must never write over the current one's state.
        if (controller.current !== next) return;
        setState({ status: 'ok', data });
      })
      .catch((err: unknown) => {
        if (controller.current !== next && !next.signal.aborted) return;
        const error = err instanceof ApiError ? err : null;

        if (error?.code === 'ABORTED') {
          // `cancel` already set the terminal state synchronously. A timeout did
          // not, so it is still `pending` and this is where it becomes an error.
          setState((current) =>
            current.status === 'cancelled'
              ? current
              : {
                  status: 'error',
                  code: 'SCAN_TIMEOUT',
                  message: `The scan took longer than ${CLIENT_TIMEOUT_MS / 1000} seconds and was stopped.`,
                },
          );
          return;
        }

        setState({
          status: 'error',
          code: error?.code ?? 'INTERNAL',
          message: error?.message ?? 'The scan failed for an unknown reason.',
        });
      })
      .finally(() => {
        clearTimeout(timer);
        if (controller.current === next) controller.current = null;
      });
  }, []);

  return { state, start, cancel };
}
