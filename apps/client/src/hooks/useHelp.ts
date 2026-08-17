import { useCallback, useState } from 'react';
import { ApiError, requestExplanation } from '../lib/api.ts';

export type HelpState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'ok'; markdown: string; model: string }
  | { status: 'error'; message: string };

const IDLE: HelpState = { status: 'idle' };

export interface UseHelp {
  get: (scanId: string, violationId: string, nodeIndex: number) => HelpState;
  request: (scanId: string, violationId: string, nodeIndex: number) => void;
}

/**
 * One map for every explanation on the page, rather than one hook per node.
 *
 * The key includes `scanId`, and that is not decoration. Keyed on rule and index
 * alone, a second scan would find the first scan's entry: the panel would render
 * a confident explanation of markup that is no longer on screen, and because a
 * non-idle entry suppresses the refetch, no request would ever correct it. For an
 * accessibility tool that is the worst failure available. `scanId` changes every
 * scan, so old entries become unreachable.
 */
export function useHelp(): UseHelp {
  const [byNode, setByNode] = useState<Record<string, HelpState>>({});

  const get = useCallback(
    (scanId: string, violationId: string, nodeIndex: number) =>
      byNode[`${scanId}::${violationId}::${nodeIndex}`] ?? IDLE,
    [byNode],
  );

  const request = useCallback((scanId: string, violationId: string, nodeIndex: number) => {
    const key = `${scanId}::${violationId}::${nodeIndex}`;
    setByNode((current) => ({ ...current, [key]: { status: 'pending' } }));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    requestExplanation({ scanId, violationId, nodeIndex }, controller.signal)
      .then((response) => {
        setByNode((current) => ({
          ...current,
          [key]: { status: 'ok', markdown: response.explanation, model: response.model },
        }));
      })
      .catch((err: unknown) => {
        const message =
          err instanceof ApiError && err.code !== 'ABORTED'
            ? err.message
            : 'The explanation request was interrupted.';
        setByNode((current) => ({ ...current, [key]: { status: 'error', message } }));
      })
      .finally(() => clearTimeout(timer));
  }, []);

  return { get, request };
}
