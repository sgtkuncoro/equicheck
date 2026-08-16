import { randomUUID } from 'node:crypto';
import { limits } from '../config.js';
import type { ScanResponse, WireNode, WireViolation } from '../../../shared/wire.js';

interface Entry {
  response: ScanResponse;
  expiresAt: number;
}

/**
 * Scans live in memory for a short window so `/api/explain` can look up what to
 * send the model instead of trusting a client-supplied payload.
 *
 * That choice is the whole point of this module. If the client posted the
 * violation and markup directly, `/api/explain` would be an open proxy that
 * forwards arbitrary attacker text to a paid LLM, with no tie to anything a
 * real scan produced. Here it can only ever echo back data this server
 * generated, so the shape and the size are both bounded by the scan pipeline.
 *
 * A Map is enough: one process, no persistence requirement, expiry is a
 * convenience rather than a correctness property.
 */
const store = new Map<string, Entry>();

export function putScan(response: Omit<ScanResponse, 'scanId'>): ScanResponse {
  // Bound the map, not just each entry's lifetime. A snippet engineered to trip
  // many rules with many nodes makes a multi-megabyte entry that lives for the
  // full TTL, so a size cap is what actually limits memory. Insertion order is
  // chronological, so the first key is the oldest.
  while (store.size >= limits.maxCachedScans) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
  const withId: ScanResponse = {
    ...response,
    scanId: randomUUID(),
    // The target string reaches the LLM prompt, and it is user-supplied, so an
    // absurdly long path would otherwise be billable prompt input on every
    // explain call.
    target: response.target.slice(0, limits.maxTargetChars),
  };
  store.set(withId.scanId, { response: withId, expiresAt: Date.now() + limits.scanTtlMs });
  return withId;
}

export interface ExplainTarget {
  violation: WireViolation;
  node: WireNode;
  nodeIndex: number;
  target: string;
}

/** Returns null for an unknown, expired, or out-of-range lookup. All three are the same 404 to a caller. */
export function findExplainTarget(
  scanId: string,
  violationId: string,
  nodeIndex: number,
): ExplainTarget | null {
  const entry = store.get(scanId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(scanId);
    return null;
  }

  const violation = entry.response.violations.find((candidate) => candidate.id === violationId);
  const node = violation?.nodes[nodeIndex];
  if (!violation || !node) return null;

  return { violation, node, nodeIndex, target: entry.response.target };
}

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [scanId, entry] of store) {
    if (entry.expiresAt <= now) store.delete(scanId);
  }
}, limits.storeSweepIntervalMs);
// Never hold the process open on this timer alone.
sweep.unref();
