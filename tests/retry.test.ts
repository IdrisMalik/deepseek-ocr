import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRetryAfter, retryDelayMs } from '../src/utils/retry.js';

test('parseRetryAfter supports delta-seconds and HTTP dates', () => {
  assert.equal(parseRetryAfter('2'), 2000);
  assert.equal(parseRetryAfter(' 5 '), 5000);
  assert.equal(parseRetryAfter('garbage'), undefined);
  assert.equal(parseRetryAfter(null), undefined);
  const now = 1_700_000_000_000;
  const future = new Date(now + 3000).toUTCString();
  assert.equal(parseRetryAfter(future, now), 3000);
});

test('retryDelayMs grows exponentially without jitter and caps the delay', () => {
  const options = { baseDelayMs: 10, maxDelayMs: 50, jitterRatio: 0 };
  assert.equal(retryDelayMs(1, new Error(), options), 10);
  assert.equal(retryDelayMs(2, new Error(), options), 20);
  assert.equal(retryDelayMs(3, new Error(), options), 40);
  assert.equal(retryDelayMs(4, new Error(), options), 50);
});

test('retryDelayMs honours and caps a server-provided interval', () => {
  assert.equal(retryDelayMs(1, new Error(), { getRetryAfterMs: () => 1234 }), 1234);
  assert.equal(
    retryDelayMs(1, new Error(), { getRetryAfterMs: () => 999_999, maxRetryAfterMs: 2000 }),
    2000
  );
});

test('retryDelayMs keeps jitter within the configured band', () => {
  const original = Math.random;
  try {
    Math.random = () => 1;
    assert.equal(retryDelayMs(1, new Error(), { baseDelayMs: 100, jitterRatio: 0.25 }), 125);
    Math.random = () => 0;
    assert.equal(retryDelayMs(1, new Error(), { baseDelayMs: 100, jitterRatio: 0.25 }), 75);
  } finally {
    Math.random = original;
  }
});
