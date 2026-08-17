import type { RequestHandler } from 'express';
import net from 'node:net';
import { limits } from '../config.js';
import { ServiceError } from '../errors.js';

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Key an IPv6 peer by its /64 rather than its exact address.
 *
 * A residential or cloud IPv6 allocation is normally a /64, and a client can
 * source from a different address inside it on every request. Keying the full
 * address would give each of those a fresh window, so the limit would simply not
 * apply to IPv6 clients, and the map would grow with request volume instead of
 * with client count.
 */
function bucketFor(ip: string | undefined): string {
  if (!ip) return 'unknown';
  if (!net.isIPv6(ip)) return ip;
  return ip.toLowerCase().split(':').slice(0, 4).join(':');
}

const windows = new Map<string, Window>();

/**
 * Fixed-window limiter, in process memory.
 *
 * Hand-rolled rather than pulled from a package: it is twenty lines, and the
 * alternative adds a dependency whose configuration surface is larger than this
 * file. Per-process, so it does not survive a restart and would not hold across
 * replicas. That is acceptable for a single-instance prototype and is called out
 * as a scaling limit in the README rather than pretended otherwise.
 */

export const rateLimit: RequestHandler = (req, _res, next) => {
  const key = bucketFor(req.ip);
  const now = Date.now();
  const current = windows.get(key);

  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + limits.rateLimitWindowMs });
    next();
    return;
  }

  current.count += 1;
  if (current.count > limits.rateLimitMax) {
    next(
      new ServiceError(
        'RATE_LIMITED',
        `Too many requests. Wait ${Math.ceil((current.resetAt - now) / 1000)} seconds and try again.`,
      ),
    );
    return;
  }
  next();
};

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}, limits.rateLimitWindowMs);
sweep.unref();
