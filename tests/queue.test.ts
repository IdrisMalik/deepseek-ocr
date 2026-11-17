import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWithRetries } from '../src/utils/queue.js';
import { sleep } from '../src/utils/retry.js';

type Retryable = Error & { retryable?: boolean };
const transient = (): Retryable => Object.assign(new Error('transient'), { retryable: true });
const permanent = (): Retryable => Object.assign(new Error('permanent'), { retryable: false });
const retryable = (error: unknown): boolean =>
  error instanceof Error && Boolean((error as Retryable).retryable);

const base = { concurrency: 1, maxAttempts: 3, baseDelayMs: 1, jitterRatio: 0, isRetryable: retryable };

test('retries a transient failure then succeeds', async () => {
  let calls = 0;
  const results = await mapWithRetries(
    [1],
    async () => {
      calls += 1;
      if (calls === 1) throw transient();
      return calls;
    },
    base
  );
  assert.equal(calls, 2);
  assert.deepEqual(results, [{ status: 'fulfilled', value: 2 }]);
});

test('does not retry a permanent error', async () => {
  let calls = 0;
  const results = await mapWithRetries(
    [1],
    async () => {
      calls += 1;
      throw permanent();
    },
    base
  );
  assert.equal(calls, 1);
  assert.equal(results[0].status, 'rejected');
});

test('stops after the configured retry allowance', async () => {
  let calls = 0;
  const results = await mapWithRetries(
    [1],
    async () => {
      calls += 1;
      throw transient();
    },
    { ...base, maxAttempts: 2 }
  );
  assert.equal(calls, 2, 'no more than maxAttempts requests');
  assert.equal(results[0].status, 'rejected');
});

test('honours a server-provided retry interval', async () => {
  let calls = 0;
  const started = Date.now();
  await mapWithRetries(
    [1],
    async () => {
      calls += 1;
      if (calls === 1) throw transient();
      return 'ok';
    },
    {
      ...base,
      maxAttempts: 2,
      baseDelayMs: 1,
      maxRetryAfterMs: 500,
      getRetryAfterMs: () => 80,
    }
  );
  assert.ok(Date.now() - started >= 60, 'retry waited for the supplied interval');
});

test('never exceeds the concurrency limit and frees slots during backoff', async () => {
  let active = 0;
  let maxActive = 0;
  const started: number[] = [];
  let firstFailure = true;
  const results = await mapWithRetries(
    [0, 1, 2, 3],
    async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(item);
      try {
        await sleep(8);
        if (item === 0 && firstFailure) {
          firstFailure = false;
          throw transient();
        }
        return item;
      } finally {
        active -= 1;
      }
    },
    { ...base, concurrency: 2, baseDelayMs: 40 }
  );

  assert.ok(maxActive <= 2, `concurrency exceeded: ${maxActive}`);
  assert.ok(
    started.indexOf(2) < started.lastIndexOf(0),
    'unrelated file started while the failed one was backing off'
  );
  assert.deepEqual(
    results.map((r) => (r.status === 'fulfilled' ? r.value : 'failed')),
    [0, 1, 2, 3]
  );
});

test('isolates a permanently failed file from the rest of the batch', async () => {
  const results = await mapWithRetries(
    [0, 1, 2, 3],
    async (item) => {
      if (item === 1) throw permanent();
      return item * 10;
    },
    base
  );
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[2].status, 'fulfilled');
  assert.equal(results[3].status, 'fulfilled');
});

test('cancellation stops queued work and aborts pending retries', async () => {
  const controller = new AbortController();
  const started: number[] = [];
  const attempts = new Map<number, number>();
  const promise = mapWithRetries(
    [0, 1, 2, 3, 4, 5],
    async (item) => {
      started.push(item);
      attempts.set(item, (attempts.get(item) ?? 0) + 1);
      // Item 0 fails immediately and is parked in a long backoff when we abort.
      if (item === 0) throw transient();
      await sleep(30);
      return item;
    },
    { ...base, concurrency: 2, baseDelayMs: 200, signal: controller.signal }
  );
  await sleep(20);
  controller.abort();
  const results = await promise;

  assert.ok(results.every((r) => r.status === 'rejected'));
  assert.ok(started.length < 6, 'queued files did not start after abort');
  assert.equal(attempts.get(0), 1, 'delayed retry did not start after abort');
});

test('a late resolution after abort cannot become a stale success', async () => {
  const controller = new AbortController();
  let release: ((value: number) => void) | undefined;
  const promise = mapWithRetries(
    [1],
    () => new Promise<number>((resolve) => { release = resolve; }),
    { ...base, signal: controller.signal }
  );
  await sleep(5);
  controller.abort();
  release?.(42);
  const results = await promise;
  assert.equal(results[0].status, 'rejected');
});

test('results keep input order despite varied completion times', async () => {
  const results = await mapWithRetries(
    [0, 1, 2],
    async (item) => {
      await sleep((3 - item) * 6);
      return `file-${item}`;
    },
    { ...base, concurrency: 3 }
  );
  assert.deepEqual(
    results.map((r) => (r.status === 'fulfilled' ? r.value : '')),
    ['file-0', 'file-1', 'file-2']
  );
});

test('reports each terminal outcome once, after retries settle', async () => {
  let failedOnce = false;
  const seen: Array<{ index: number; status: string; value?: number }> = [];
  const results = await mapWithRetries(
    [7, 8],
    async (item) => {
      if (item === 7 && !failedOnce) {
        failedOnce = true;
        throw transient();
      }
      return item * 2;
    },
    {
      ...base,
      onTerminal: (index, result) => {
        seen.push({
          index,
          status: result.status,
          ...(result.status === 'fulfilled' ? { value: result.value } : {}),
        });
      },
    }
  );

  assert.deepEqual(
    seen.sort((a, b) => a.index - b.index),
    [
      { index: 0, status: 'fulfilled', value: 14 },
      { index: 1, status: 'fulfilled', value: 16 },
    ]
  );
  assert.equal(results[0].status, 'fulfilled');
});

test('reports a rejected terminal outcome after retry exhaustion', async () => {
  const seen: string[] = [];
  await mapWithRetries(
    [1],
    async () => {
      throw transient();
    },
    { ...base, maxAttempts: 2, onTerminal: (_index, result) => seen.push(result.status) }
  );
  assert.deepEqual(seen, ['rejected']);
});
