import test from 'node:test';
import assert from 'node:assert/strict';
import { createOcrQueueOptions, runOcrBatch, type OcrBatchOptions } from '../src/app/ocrBatch.js';
import { beginExtraction } from '../src/app/state.js';
import { isRetryableOcrError, ocrRetryAfterMs, OcrError } from '../src/services/api/errors.js';
import { clientConfig } from '../src/utils/config.js';
import type { FileItem, FileOcrResult } from '../src/services/api/types.js';

const result = (text: string): FileOcrResult => ({
  pages: [{ index: 0, text, finishReason: 'stop' }],
});

let nextId = 0;

function item(overrides: Partial<FileItem> = {}): FileItem {
  nextId += 1;
  const id = overrides.id ?? `batch-${nextId}`;
  const name = overrides.name ?? `${id}.png`;
  return {
    id,
    name,
    size: 1,
    mimeType: 'image/png',
    blob: new Blob(['x'], { type: 'image/png' }),
    previewUrl: '',
    rotation: 0,
    status: 'ready',
    purpose: null,
    error: null,
    result: null,
    editedText: null,
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : 'Extraction failed.';

// Short delays keep retry tests fast without changing the production policy.
const fastRetry = {
  concurrency: 1,
  maxAttempts: 1,
  baseDelayMs: 1,
  maxDelayMs: 1,
  jitterRatio: 0,
};

function batchOptions(
  items: readonly FileItem[],
  overrides: Partial<OcrBatchOptions> = {}
): OcrBatchOptions {
  return {
    items,
    purpose: 'text_recognition',
    apiKey: 'test-key',
    signal: new AbortController().signal,
    formatError,
    retry: fastRetry,
    ...overrides,
  };
}

test('runs queued items and commits each successful result as it settles', async () => {
  const first = item({ id: 'first', name: 'first.png' });
  const second = item({ id: 'second', name: 'second.png' });
  const untouched = item({ id: 'untouched', name: 'untouched.png' });
  const changes: string[] = [];
  const progress: Array<[number, number, boolean]> = [];
  const prepared: string[] = [];

  const summary = await runOcrBatch(
    batchOptions([first, second], {
      prepare: async (candidate) => {
        prepared.push(candidate.name);
        return { blob: candidate.blob, filename: `prepared-${candidate.name}` };
      },
      recognize: async (file) => result(`text for ${file.name}`),
      onItemChange: (candidate) => changes.push(`${candidate.id}:${candidate.status}`),
      onProgress: (done, total, aborted) => progress.push([done, total, aborted]),
    })
  );

  assert.deepEqual(prepared, ['first.png', 'second.png']);
  assert.deepEqual(changes, ['first:processing', 'first:done', 'second:processing', 'second:done']);
  assert.deepEqual(progress, [
    [1, 2, false],
    [2, 2, false],
  ]);
  assert.equal(first.status, 'done');
  assert.equal(first.purpose, 'text_recognition');
  assert.equal(first.error, null);
  assert.equal(first.result?.pages[0].text, 'text for prepared-first.png');
  assert.equal(second.status, 'done');
  assert.equal(second.result?.pages[0].text, 'text for prepared-second.png');
  assert.equal(untouched.status, 'ready');
  assert.equal(untouched.result, null);
  assert.deepEqual(summary, { cancelled: false, failures: [] });
});

test('a failed item preserves committed output while successes replace theirs', async () => {
  const committed = result('committed text');
  const failed = item({
    id: 'preserved',
    name: 'preserved.png',
    status: 'done',
    purpose: 'text_recognition',
    result: committed,
    editedText: 'manual edit',
  });
  beginExtraction(failed);
  const recovered = item({ id: 'recovered', name: 'recovered.png' });

  const summary = await runOcrBatch(
    batchOptions([failed, recovered], {
      recognize: async (file) => {
        if (file.name === 'preserved.png') throw new Error('provider rejected');
        return result('recovered text');
      },
    })
  );

  assert.equal(failed.status, 'error');
  assert.equal(failed.error, 'provider rejected');
  assert.equal(failed.result, committed);
  assert.equal(failed.editedText, 'manual edit');
  assert.equal(failed.purpose, 'text_recognition');
  assert.equal(recovered.status, 'done');
  assert.equal(recovered.result?.pages[0].text, 'recovered text');
  assert.equal(summary.cancelled, false);
  assert.deepEqual(summary.failures, [failed]);
});

test('reports every failure in input order using the supplied formatter', async () => {
  const second = item({ id: 'second-failure', name: 'b.png' });
  const first = item({ id: 'first-failure', name: 'a.png' });

  const summary = await runOcrBatch(
    batchOptions([second, first], {
      recognize: async (file) => {
        if (file.name === 'a.png') throw 'not an error';
        throw new Error('b failed');
      },
      formatError: (error) => (error instanceof Error ? error.message : 'fallback message'),
    })
  );

  assert.deepEqual(
    summary.failures.map((candidate) => candidate.id),
    ['second-failure', 'first-failure']
  );
  assert.equal(second.error, 'b failed');
  assert.equal(first.error, 'fallback message');
});

test('aborting cancels queued and in-flight work without committing late results', async () => {
  const committed = result('previous committed text');
  const first = item({
    id: 'cancel-first',
    name: 'cancel-first.png',
    status: 'done',
    purpose: 'text_recognition',
    result: committed,
  });
  beginExtraction(first);
  const second = item({ id: 'cancel-second', name: 'cancel-second.png' });
  const controller = new AbortController();
  const started = deferred<void>();
  const pending = deferred<FileOcrResult>();
  const changes: string[] = [];
  const progress: number[] = [];
  const calls: string[] = [];

  const run = runOcrBatch(
    batchOptions([first, second], {
      signal: controller.signal,
      recognize: (file) => {
        calls.push(file.name);
        if (file.name === 'cancel-first.png') {
          started.resolve();
          return pending.promise;
        }
        return Promise.resolve(result('second text'));
      },
      onItemChange: (candidate) => changes.push(`${candidate.id}:${candidate.status}`),
      onProgress: (done) => progress.push(done),
    })
  );

  await started.promise;
  controller.abort();
  pending.resolve(result('late first text'));
  const summary = await run;

  assert.deepEqual(calls, ['cancel-first.png']);
  assert.deepEqual(changes, ['cancel-first:processing']);
  assert.deepEqual(progress, []);
  assert.equal(first.status, 'cancelled');
  assert.equal(first.result, committed);
  assert.equal(first.purpose, 'text_recognition');
  assert.equal(second.status, 'cancelled');
  assert.equal(second.result, null);
  assert.equal(summary.cancelled, true);
  assert.deepEqual(summary.failures, []);
});

test('retries a transient provider error before committing the replacement', async () => {
  const target = item({
    id: 'retry-target',
    name: 'retry-target.png',
    status: 'done',
    purpose: 'text_recognition',
    result: result('old text'),
    editedText: 'old edit',
  });
  beginExtraction(target);
  let attempts = 0;
  const changes: string[] = [];
  const progress: number[] = [];

  const summary = await runOcrBatch(
    batchOptions([target], {
      retry: { concurrency: 1, maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
      recognize: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new OcrError('busy', {
            code: 'rate_limited',
            retryable: true,
            status: 429,
          });
        }
        return result('new text');
      },
      onItemChange: (candidate) => changes.push(candidate.status),
      onProgress: (done) => progress.push(done),
    })
  );

  assert.equal(attempts, 2);
  // A retry re-enters the worker, so processing is announced for each attempt.
  assert.deepEqual(changes, ['processing', 'processing', 'done']);
  assert.deepEqual(progress, [1]);
  assert.equal(target.status, 'done');
  assert.equal(target.result?.pages[0].text, 'new text');
  assert.equal(target.editedText, null);
  assert.deepEqual(summary.failures, []);
});

test('does not retry a permanent provider error', async () => {
  const target = item({ id: 'permanent-target', name: 'permanent-target.png' });
  let attempts = 0;

  const summary = await runOcrBatch(
    batchOptions([target], {
      retry: { concurrency: 1, maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
      recognize: async () => {
        attempts += 1;
        throw new OcrError('bad key', {
          code: 'unauthorized',
          retryable: false,
          status: 401,
        });
      },
    })
  );

  assert.equal(attempts, 1);
  assert.equal(target.status, 'error');
  assert.equal(target.error, 'bad key');
  assert.deepEqual(summary.failures, [target]);
});

test('the shared queue policy matches production configuration and retry hooks', () => {
  const policy = createOcrQueueOptions();
  assert.equal(policy.concurrency, clientConfig.concurrency);
  assert.equal(policy.maxAttempts, clientConfig.maxAttempts);
  assert.equal(policy.baseDelayMs, clientConfig.retryBaseMs);
  assert.equal(policy.maxDelayMs, clientConfig.retryMaxMs);
  assert.equal(policy.maxRetryAfterMs, clientConfig.retryMaxRetryAfterMs);
  assert.equal(policy.jitterRatio, clientConfig.retryJitterRatio);
  assert.equal(policy.isRetryable, isRetryableOcrError);
  assert.equal(policy.getRetryAfterMs, ocrRetryAfterMs);

  const retryable = new OcrError('wait', {
    code: 'rate_limited',
    retryable: true,
    retryAfterMs: 250,
  });
  assert.equal(policy.isRetryable(retryable), true);
  assert.equal(policy.getRetryAfterMs?.(retryable), 250);

  const overridden = createOcrQueueOptions({
    concurrency: 2,
    maxAttempts: 5,
    baseDelayMs: 7,
    maxDelayMs: 8,
    maxRetryAfterMs: 9,
    jitterRatio: 0.1,
  });
  assert.equal(overridden.concurrency, 2);
  assert.equal(overridden.maxAttempts, 5);
  assert.equal(overridden.baseDelayMs, 7);
  assert.equal(overridden.maxDelayMs, 8);
  assert.equal(overridden.maxRetryAfterMs, 9);
  assert.equal(overridden.jitterRatio, 0.1);
});
