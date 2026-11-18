/**
 * Bounded, work-conserving task queue with per-task retries.
 *
 * A transient failure releases its slot immediately and schedules a retry for
 * later, so unrelated queued work keeps moving instead of waiting out a
 * backoff. Retries are bounded by `maxAttempts`; terminal outcomes are returned
 * in input order and a failure never cancels the rest of the batch.
 */
import { abortError, retryDelayMs, type RetryDelayOptions } from './retry.js';

export type QueueResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown };

export type QueueOptions<T> = RetryDelayOptions & {
  concurrency: number;
  maxAttempts: number;
  isRetryable: (error: unknown) => boolean;
  signal?: AbortSignal;
  /** Called once per normally settled file, never per attempt or on cancellation. */
  onTerminal?: (index: number, result: QueueResult<T>) => void;
};

export async function mapWithRetries<T, R>(
  items: readonly T[],
  worker: (item: T, index: number, attempt: number) => Promise<R>,
  options: QueueOptions<R>
): Promise<QueueResult<R>[]> {
  const count = items.length;
  const results = new Array<QueueResult<R>>(count);
  const attempts = new Array<number>(count).fill(0);
  const ready = items.map((_, index) => index);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const waiters: Array<() => void> = [];
  let pending = count;
  let aborted = options.signal?.aborted === true;

  const notify = (): void => {
    const list = waiters.splice(0);
    for (const resolve of list) resolve();
  };

  const failRemaining = (): void => {
    for (let i = 0; i < count; i += 1) {
      if (results[i] === undefined) results[i] = { status: 'rejected', reason: abortError() };
    }
    pending = 0;
    notify();
  };

  const onAbort = (): void => {
    aborted = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    failRemaining();
  };

  if (aborted) failRemaining();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts || 1));
  const limit = Math.max(1, Math.min(Math.floor(options.concurrency || 1), Math.max(1, count)));

  const runWorker = async (): Promise<void> => {
    while (!aborted) {
      const index = ready.shift();
      if (index === undefined) {
        if (pending === 0) return;
        await new Promise<void>((resolve) => waiters.push(resolve));
        continue;
      }

      attempts[index] += 1;
      try {
        const value = await worker(items[index], index, attempts[index]);
        if (aborted) return;
        results[index] = { status: 'fulfilled', value };
      } catch (error) {
        if (aborted) return;
        if (attempts[index] < maxAttempts && options.isRetryable(error)) {
          // Release the slot now; re-enter the ready queue only after the delay.
          const delay = retryDelayMs(attempts[index], error, options);
          const timer = setTimeout(() => {
            timers.delete(index);
            if (aborted) return;
            ready.push(index);
            notify();
          }, delay);
          timers.set(index, timer);
          continue;
        }
        results[index] = { status: 'rejected', reason: error };
      }
      const outcome = results[index];
      if (outcome) {
        pending -= 1;
        options.onTerminal?.(index, outcome);
        notify();
      }
    }
  };

  try {
    if (!aborted && count > 0) await Promise.all(Array.from({ length: limit }, runWorker));
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  return results;
}
