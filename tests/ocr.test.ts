import test from 'node:test';
import assert from 'node:assert/strict';
import { mapHttpError, OcrError, parseOcrResponse } from '../src/services/api/errors.js';
import { recognizeFile, recognizeFileOnce, OcrClientError } from '../src/services/api/client.js';

const file = { name: 'a.png', bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' };
const key = 'test-key';
const signal = () => new AbortController().signal;

test('mapHttpError maps documented statuses and retryability', () => {
  assert.equal(mapHttpError(400, {}).retryable, false);
  assert.equal(mapHttpError(401, {}).retryable, false);
  assert.equal(mapHttpError(402, {}).retryable, false);
  assert.equal(mapHttpError(413, {}).retryable, false);
  assert.equal(mapHttpError(429, {}).retryable, true);
  assert.equal(mapHttpError(503, {}).retryable, true);
  assert.match(mapHttpError(400, {}).message, /could not process/i);
  assert.match(mapHttpError(401, {}).message, /api key/i);
  const withRetryAfter = mapHttpError(429, {}, new Headers({ 'Retry-After': '2' }));
  assert.equal(withRetryAfter.retryAfterMs, 2000);
});

test('parseOcrResponse tolerates keep-alive newlines and maps pages', () => {
  const body = '\n\n' + JSON.stringify({
    page_count: 1,
    pages: [{ index: 0, text: 'Page one.', finish_reason: 'stop' }],
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
  });
  const parsed = parseOcrResponse(body, 'doc.png');
  assert.equal(parsed.pages.length, 1);
  assert.equal(parsed.inputTokens, 10);
});

test('parseOcrResponse rejects empty, malformed and non-string responses', () => {
  assert.throws(() => parseOcrResponse(JSON.stringify({ pages: [] }), 'a.png'),
    (e: unknown) => e instanceof OcrError && e.code === 'empty_response');
  assert.throws(() => parseOcrResponse(JSON.stringify({ pages: [{ index: 0 }] }), 'a.png'),
    (e: unknown) => e instanceof OcrError && e.code === 'bad_response');
  assert.throws(() => parseOcrResponse(JSON.stringify({ pages: [{ index: 0, text: '  ' }] }), 'a.png'),
    (e: unknown) => e instanceof OcrError && e.code === 'empty_result' && !e.retryable);
});

test('parseOcrResponse preserves Rich Layout raw tokens for client cleanup', () => {
  const raw = '<｜ref｜>text<｜/ref｜><｜box｜>[[1,2,3,4]]<｜/box｜> Heading';
  const parsed = parseOcrResponse(JSON.stringify({ pages: [{ index: 0, text: raw }] }), 'a.png');
  assert.equal(parsed.pages[0].text, raw);
});

test('recognizeFile posts multipart with Authorization and parses response', async () => {
  const original = globalThis.fetch;
  const captured: { url?: string; init?: RequestInit } = {};
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.url = String(url);
    captured.init = init;
    return new Response(JSON.stringify({ pages: [{ index: 0, text: 'Live result 你好', finish_reason: 'stop' }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await recognizeFile(file, 'text_recognition', key, signal());
    assert.equal(result.pages[0].text, 'Live result 你好');
    assert.equal(captured.url, 'https://api.deepseek.com/v1/tools/ocr');
    assert.equal(captured.init?.method, 'POST');
    const headers = captured.init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer test-key');
    const form = captured.init?.body as FormData;
    assert.equal(form.get('purpose'), 'text_recognition');
    const uploaded = form.get('file');
    assert.ok(uploaded instanceof File);
    assert.equal(uploaded.name, 'a.png');
  } finally {
    globalThis.fetch = original;
  }
});

test('recognizeFile rejects a missing key without any network call', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response('{}', { status: 200 }); }) as typeof fetch;
  try {
    await assert.rejects(
      () => recognizeFile(file, 'text_recognition', '', signal()),
      (e: unknown) => e instanceof OcrClientError && e.code === 'no_key'
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test('recognizeFile retries malformed responses that are marked retryable', async () => {
  const original = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts < 3) return new Response('not json', { status: 200 });
    return new Response(JSON.stringify({ pages: [{ index: 0, text: 'recovered', finish_reason: 'stop' }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await recognizeFile(file, 'text_recognition', key, signal());
    assert.equal(result.pages[0].text, 'recovered');
    assert.equal(attempts, 3);
  } finally {
    globalThis.fetch = original;
  }
});

test('recognizeFileOnce makes exactly one request and leaves retries to the scheduler', async () => {
  const original = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    return new Response(JSON.stringify({ error: { message: 'busy' } }), {
      status: 429,
      headers: { 'Retry-After': '0' },
    });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => recognizeFileOnce(file, 'text_recognition', key, signal()),
      (e: unknown) => e instanceof OcrClientError && e.code === 'rate_limited'
    );
    assert.equal(attempts, 1, 'the batch scheduler owns the retry, not the client');
  } finally {
    globalThis.fetch = original;
  }
});

test('recognizeFileOnce maps abort during the response body to cancellation', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = (async () => {
    controller.abort();
    return {
      ok: true,
      text: async () => {
        throw new DOMException('Aborted', 'AbortError');
      },
      headers: new Headers(),
    } as unknown as Response;
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => recognizeFileOnce(file, 'text_recognition', key, controller.signal),
      (e: unknown) => e instanceof OcrClientError && e.code === 'cancelled'
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('recognizeFileOnce preserves provider details for non-tabulated errors', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ error: { message: 'Unsupported purpose for this file', code: 'invalid_purpose' } }),
      { status: 422 }
    )) as typeof fetch;
  try {
    await assert.rejects(
      () => recognizeFileOnce(file, 'text_recognition', key, signal()),
      (e: unknown) =>
        e instanceof OcrClientError &&
        e.message === 'Unsupported purpose for this file' &&
        e.code === 'invalid_purpose' &&
        e.retryable === false
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('recognizeFile retries boundedly on 429 and stops on 401', async () => {
  const original = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 429, headers: { 'Retry-After': '0' } });
  }) as typeof fetch;
  try {
    await assert.rejects(() => recognizeFile(file, 'text_recognition', key, signal()),
      (e: unknown) => e instanceof OcrClientError && e.code === 'rate_limited');
    assert.equal(attempts, 3);
  } finally { globalThis.fetch = original; }

  attempts = 0;
  globalThis.fetch = (async () => { attempts += 1; return new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401 }); }) as typeof fetch;
  try {
    await assert.rejects(() => recognizeFile(file, 'text_recognition', key, signal()),
      (e: unknown) => e instanceof OcrClientError && e.code === 'unauthorized');
    assert.equal(attempts, 1, '401 is not retried');
  } finally { globalThis.fetch = original; }
});
