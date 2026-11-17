import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRetryAfter, sleep, withRetry } from '../src/utils/retry.js';

test('parseRetryAfter supports delta-seconds and HTTP dates', () => {
  assert.equal(parseRetryAfter('2'), 2000);
  assert.equal(parseRetryAfter(' 5 '), 5000);
  assert.equal(parseRetryAfter('garbage'), undefined);
  assert.equal(parseRetryAfter(null), undefined);
  const future = new Date(Date.now() + 3000).toUTCString();
  const parsed = parseRetryAfter(future);
  assert.ok(parsed !== undefined && parsed > 2000 && parsed <= 3000);
});

test('withRetry retries transient failures up to the bounded attempt count', async () => {
  let attempts = 0;
  const delays: number[] = [];
  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('transient');
      return 'ok';
    },
    {
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 50,
      jitterRatio: 0,
      sleep: async (ms) => {
        delays.push(ms);
      },
    }
  );
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20], 'exponential backoff without jitter');
});

test('withRetry stops immediately on permanent errors and never exceeds maxAttempts', async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      async () => {
        attempts += 1;
        throw new Error('permanent');
      },
      { maxAttempts: 5, isRetryable: () => false, sleep: async () => {} }
    ),
    /permanent/
  );
  assert.equal(attempts, 1);

  attempts = 0;
  await assert.rejects(
    withRetry(
      async () => {
        attempts += 1;
        throw new Error('always');
      },
      { maxAttempts: 3, sleep: async () => {} }
    ),
    /always/
  );
  assert.equal(attempts, 3, 'bounded retries');
});

test('withRetry honours Retry-After over exponential backoff', async () => {
  const delays: number[] = [];
  class RateLimited extends Error {
    retryAfterMs = 1234;
  }
  await withRetry(
    async (attempt) => {
      if (attempt === 1) throw new RateLimited('429');
      return 'ok';
    },
    {
      maxAttempts: 2,
      baseDelayMs: 1,
      maxDelayMs: 5,
      sleep: async (ms) => {
        delays.push(ms);
      },
      getRetryAfterMs: (e) => (e instanceof RateLimited ? e.retryAfterMs : undefined),
    }
  );
  assert.deepEqual(delays, [1234]);
});

test('withRetry caps Retry-After and adds jitter within bounds', async () => {
  const delays: number[] = [];
  class RateLimited extends Error {
    retryAfterMs = 999999;
  }
  await withRetry(
    async (attempt) => {
      if (attempt === 1) throw new RateLimited('429');
      return 'ok';
    },
    {
      maxAttempts: 2,
      maxRetryAfterMs: 2000,
      sleep: async (ms) => {
        delays.push(ms);
      },
      getRetryAfterMs: (e) => (e instanceof RateLimited ? e.retryAfterMs : undefined),
    }
  );
  assert.equal(delays[0], 2000);
});

test('abort during backoff stops retries promptly', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const pending = withRetry(
    async () => {
      attempts += 1;
      throw new Error('transient');
    },
    {
      maxAttempts: 5,
      baseDelayMs: 5000,
      sleep: (ms, signal) => sleep(ms, signal),
      signal: controller.signal,
    }
  );
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, (e: Error) => e.name === 'AbortError');
  assert.equal(attempts, 1, 'no extra attempt after abort during backoff');
});
