/**
 * Retry delay policy shared by the work queue. It has no browser-only
 * dependencies, so tests and the production bundle use the same implementation.
 */

/** Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now()
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Math.max(0, Number(trimmed) * 1000);
  const timestamp = Date.parse(trimmed);
  if (!Number.isNaN(timestamp)) return Math.max(0, timestamp - now);
  return undefined;
}

export function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

export type RetryDelayOptions = {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxRetryAfterMs?: number;
  jitterRatio?: number;
  getRetryAfterMs?: (error: unknown) => number | undefined;
};

/**
 * Bounded exponential backoff with symmetric jitter. An explicit server
 * interval (Retry-After) wins when present, capped to avoid a stalled client.
 */
export function retryDelayMs(
  attempt: number,
  error: unknown,
  options: RetryDelayOptions = {}
): number {
  const base = Math.max(0, options.baseDelayMs ?? 500);
  const cap = Math.max(0, options.maxDelayMs ?? 8000);
  const retryAfterCap = Math.max(0, options.maxRetryAfterMs ?? 60000);
  const jitter = Math.min(0.99, Math.max(0, options.jitterRatio ?? 0.25));
  const explicit = options.getRetryAfterMs?.(error);
  if (explicit !== undefined) return Math.min(retryAfterCap, Math.max(0, explicit));
  const exponential = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  const variance = exponential * jitter * (Math.random() * 2 - 1);
  return Math.max(0, exponential + variance);
}
