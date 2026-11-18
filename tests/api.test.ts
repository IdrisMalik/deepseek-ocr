import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyApiKey } from '../src/services/api/client.js';
import { OcrError } from '../src/services/api/errors.js';
import { clearKey, loadKey, saveKey } from '../src/services/settings.js';

// Minimal localStorage shim for Node tests (browsers provide the real one).
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, v);
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
} as Storage;

test('verifyApiKey reports rejected keys', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: 'invalid key' } }), {
      status: 401,
    })) as typeof fetch;
  try {
    await assert.rejects(
      () => verifyApiKey('bad'),
      (e: unknown) => e instanceof OcrError && e.code === 'unauthorized'
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('API errors carry Retry-After so retries can honour it', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: 'busy' } }), {
      status: 429,
      headers: { 'Retry-After': '2' },
    })) as typeof fetch;
  try {
    await assert.rejects(
      () => verifyApiKey('k'),
      (e: unknown) => e instanceof OcrError && e.code === 'rate_limited' && e.retryAfterMs === 2000
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('key storage helpers round-trip and clear', () => {
  saveKey('sk-test-key');
  assert.equal(loadKey(), 'sk-test-key');
  clearKey();
  assert.equal(loadKey(), '');
});

test('verifyApiKey maps network failures to an actionable message', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => verifyApiKey('k'),
      (e: unknown) =>
        e instanceof OcrError && e.code === 'network' && /check your connection/i.test(e.message)
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('verifyApiKey uses verification wording for server failures', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
  try {
    await assert.rejects(
      () => verifyApiKey('k'),
      (e: unknown) =>
        e instanceof OcrError && e.message === 'Could not check the API key. Try again later.'
    );
  } finally {
    globalThis.fetch = original;
  }
});
