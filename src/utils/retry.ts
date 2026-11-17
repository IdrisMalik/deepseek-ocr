/**
 * Runtime-agnostic bounded retry helper (pure TypeScript). Sleep uses only
 * setTimeout/Promise so it works in browsers (static hosting) and Node alike.
 */

export type RetryOptions = {
  /** Total attempts including the first one. Default 3. */
  maxAttempts?: number;
  /** Base delay for exponential backoff, in ms. Default 500. */
  baseDelayMs?: number;
  /** Cap for exponential backoff, in ms. Default 8000. */
  maxDelayMs?: number;
  /** Cap for an explicit Retry-After value, in ms. Default 60000. */
  maxRetryAfterMs?: number;
  /** Symmetric jitter fraction [0,1). Default 0.25. */
  jitterRatio?: number;
  isRetryable?: (error: unknown) => boolean;
  getRetryAfterMs?: (error: unknown) => number | undefined;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/** Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
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
 * Shared by withRetry and the work queue so both use the same policy.
 */
export function retryDelayMs(attempt: number, error: unknown, options: RetryDelayOptions = {}): number {
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

/** Abortable sleep; rejects with AbortError if the signal is aborted. */
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Invoke `fn` with bounded retries. Only retries errors that `isRetryable`
 * accepts; honours an explicit Retry-After delay when supplied, otherwise uses
 * exponential backoff with jitter. Never creates more than `maxAttempts` calls.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions & { signal?: AbortSignal } = {}
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
  const isRetryable = options.isRetryable ?? (() => true);
  const doSleep = options.sleep ?? sleep;
  const signal = options.signal;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) throw abortError();
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (signal?.aborted || attempt >= maxAttempts || !isRetryable(error)) throw error;

      const delayMs = retryDelayMs(attempt, error, options);
      options.onRetry?.({ attempt, delayMs, error });
      await doSleep(delayMs, signal);
    }
  }

  throw lastError;
}
