import test from 'node:test';
import assert from 'node:assert/strict';
import { mapHttpError, OcrError, parseOcrResponse } from '../src/services/api/errors.js';
import { recognizeFileOnce } from '../src/services/api/client.js';
import { createOcrQueueOptions } from '../src/app/ocrBatch.js';
import { mapWithRetries, type QueueResult } from '../src/utils/queue.js';
import type { FileOcrResult } from '../src/services/api/types.js';

const file = { name: 'a.png', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) };
const key = 'test-key';
const signal = () => new AbortController().signal;

// Use the production policy; only shorten delays so the suite stays fast.
const retryOptions = createOcrQueueOptions({
  concurrency: 1,
  baseDelayMs: 1,
  maxDelayMs: 5,
  jitterRatio: 0,
});

function recognizeWithRetries(): Promise<QueueResult<FileOcrResult>[]> {
  return mapWithRetries(
    [0],
    () => recognizeFileOnce(file, 'text_recognition', key, signal()),
    retryOptions
  );
}

function rejectionReason(result: QueueResult<FileOcrResult>): unknown {
  assert.equal(result.status, 'rejected');
  return result.status === 'rejected' ? result.reason : undefined;
}

test('mapHttpError maps documented statuses and retryability', () => {
  assert.equal(mapHttpError(400, {}).retryable, false);
  assert.equal(mapHttpError(401, {}).retryable, false);
  assert.equal(mapHttpError(402, {}).retryable, false);
  assert.equal(mapHttpError(413, {}).retryable, false);
  assert.equal(mapHttpError(408, {}).retryable, true);
  assert.equal(mapHttpError(429, {}).retryable, true);
  assert.equal(mapHttpError(500, {}).retryable, true);
  assert.equal(mapHttpError(503, {}).retryable, true);
  assert.equal(mapHttpError(504, {}).retryable, false);
  assert.match(mapHttpError(400, {}).message, /could not be processed/i);
  assert.match(mapHttpError(401, {}).message, /api key/i);
  assert.match(mapHttpError(504, {}).message, /smaller file|split/i);
  const withRetryAfter = mapHttpError(429, {}, new Headers({ 'Retry-After': '2' }));
  assert.equal(withRetryAfter.retryAfterMs, 2000);
  assert.equal(mapHttpError(503, {}, new Headers({ 'Retry-After': '2' })).retryAfterMs, 2000);
  assert.equal(mapHttpError(504, {}, new Headers({ 'Retry-After': '2' })).retryAfterMs, undefined);
});

test('parseOcrResponse tolerates keep-alive newlines and maps pages', () => {
  const body =
    '\n\n' +
    JSON.stringify({
      page_count: 1,
      pages: [{ index: 0, text: 'Page one.', finish_reason: 'stop' }],
    });
  const parsed = parseOcrResponse(body);
  assert.equal(parsed.pages.length, 1);
  assert.equal(parsed.pages[0].text, 'Page one.');
});

test('parseOcrResponse rejects empty, malformed and non-string responses', () => {
  assert.throws(
    () => parseOcrResponse('not json'),
    (e: unknown) => e instanceof OcrError && e.code === 'bad_response'
  );
  assert.throws(
    () => parseOcrResponse('[]'),
    (e: unknown) => e instanceof OcrError && e.code === 'bad_response'
  );
  assert.throws(
    () => parseOcrResponse(JSON.stringify({ pages: [] })),
    (e: unknown) => e instanceof OcrError && e.code === 'empty_response'
  );
  assert.throws(
    () => parseOcrResponse(JSON.stringify({ pages: [{ index: 0 }] })),
    (e: unknown) => e instanceof OcrError && e.code === 'bad_response'
  );
  assert.throws(
    () => parseOcrResponse(JSON.stringify({ pages: [{ index: 0, text: '  ' }] })),
    (e: unknown) =>
      e instanceof OcrError &&
      e.code === 'empty_result' &&
      !e.retryable &&
      /Try again/.test(e.message)
  );
  // A markup-only rich page carries no recoverable text either.
  assert.throws(
    () =>
      parseOcrResponse(
        JSON.stringify({
          pages: [
            {
              index: 0,
              text: '<｜ref｜>image<｜/ref｜><｜box｜>[[0,0,999,999]]<｜/box｜>',
              finish_reason: 'stop',
            },
          ],
        })
      ),
    (e: unknown) => e instanceof OcrError && e.code === 'empty_result' && !e.retryable
  );
});

test('parseOcrResponse preserves Rich Layout raw tokens for client cleanup', () => {
  const raw = '<|ref|>text<|/ref|><|box|>[[1,2,3,4]]<|/box|> Heading';
  const parsed = parseOcrResponse(JSON.stringify({ pages: [{ index: 0, text: raw }] }));
  assert.equal(parsed.pages[0].text, raw);
});

test('parseOcrResponse rejects inconsistent page counts and indexes', () => {
  assert.throws(
    () =>
      parseOcrResponse(
        JSON.stringify({
          page_count: 2,
          pages: [{ index: 0, text: 'Only page', finish_reason: 'stop' }],
        })
      ),
    (e: unknown) => e instanceof OcrError && e.code === 'bad_response'
  );
  assert.throws(
    () =>
      parseOcrResponse(
        JSON.stringify({ pages: [{ index: 2, text: 'Bad index', finish_reason: 'stop' }] })
      ),
    (e: unknown) => e instanceof OcrError && e.code === 'bad_response'
  );
  assert.throws(
    () =>
      parseOcrResponse(
        JSON.stringify({
          pages: [
            { index: 0, text: 'One', finish_reason: 'stop' },
            { index: 0, text: 'Duplicate', finish_reason: 'stop' },
          ],
        })
      ),
    (e: unknown) => e instanceof OcrError && e.code === 'bad_response'
  );
  // Indexes must be integers below the page count and unique, so a gap in the
  // numbering is impossible by construction: n distinct values in [0, n) are
  // exactly {0 .. n-1}. This documents that invariant.
  assert.throws(
    () =>
      parseOcrResponse(
        JSON.stringify({
          pages: [
            { index: 0, text: 'One', finish_reason: 'stop' },
            { index: 2, text: 'Gap', finish_reason: 'stop' },
          ],
        })
      ),
    (e: unknown) => e instanceof OcrError && e.code === 'bad_response'
  );
});

test('parseOcrResponse sorts out-of-order pages into page order', () => {
  const parsed = parseOcrResponse(
    JSON.stringify({
      page_count: 2,
      pages: [
        { index: 1, text: 'Second', finish_reason: 'stop' },
        { index: 0, text: 'First', finish_reason: 'stop' },
      ],
    })
  );
  assert.deepEqual(
    parsed.pages.map((page) => page.text),
    ['First', 'Second']
  );
});

test('parseOcrResponse classifies documented recognition timeouts as permanent', () => {
  for (const error of [
    { message: 'OCR did not finish in time', code: 'gateway_timeout_error' },
    { message: 'OCR did not finish within 180 seconds' },
    { message: 'OCR did not finish in time', type: 'gateway_timeout_error' },
  ]) {
    assert.throws(
      () => parseOcrResponse(JSON.stringify({ error })),
      (e: unknown) =>
        e instanceof OcrError &&
        e.code === 'gateway_timeout_error' &&
        e.retryable === false &&
        /smaller file|split/i.test(e.message)
    );
  }
});

test('parseOcrResponse rewrites documented provider errors in plain language', () => {
  const cases: Array<[string, RegExp, boolean]> = [
    [
      'The file is password-protected and cannot be processed. Remove the password and upload it again.',
      /password-protected/i,
      false,
    ],
    ['Failed to recognize the file: the image could not be decoded', /could not be read/i, false],
    [
      'Failed to recognize the file: the document has more than 1000 pages',
      /more than 1,000 pages/i,
      false,
    ],
    ['file is too large: max 100 MiB', /100 MiB/i, false],
    ['Internal Server Error', /temporary problem/i, true],
    [
      'The OCR service is temporarily unavailable. Please try again later.',
      /busy right now/i,
      true,
    ],
  ];

  for (const [message, expected, retryable] of cases) {
    assert.throws(
      () => parseOcrResponse(JSON.stringify({ error: { message } })),
      (error: unknown) =>
        error instanceof OcrError && error.retryable === retryable && expected.test(error.message)
    );
  }
});

test('recognizeFileOnce posts multipart with Authorization and parses response', async () => {
  const original = globalThis.fetch;
  const captured: { url?: string; init?: RequestInit } = {};
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.url = String(url);
    captured.init = init;
    return new Response(
      JSON.stringify({ pages: [{ index: 0, text: 'Live result 你好', finish_reason: 'stop' }] }),
      { status: 200 }
    );
  }) as typeof fetch;
  try {
    const result = await recognizeFileOnce(file, 'text_recognition', key, signal());
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

test('recognizeFileOnce rejects a missing key without any network call', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => recognizeFileOnce(file, 'text_recognition', '', signal()),
      (e: unknown) => e instanceof OcrError && e.code === 'no_key'
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test('recognizeFileOnce makes exactly one request and leaves retries to the queue', async () => {
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
      (e: unknown) => e instanceof OcrError && e.code === 'rate_limited'
    );
    assert.equal(attempts, 1, 'the batch queue owns the retry, not the client');
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
      (e: unknown) => e instanceof OcrError && e.code === 'cancelled'
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('recognizeFileOnce preserves provider details for non-tabulated errors', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error: { message: 'Unsupported purpose for this file', code: 'invalid_purpose' },
      }),
      { status: 422 }
    )) as typeof fetch;
  try {
    await assert.rejects(
      () => recognizeFileOnce(file, 'text_recognition', key, signal()),
      (e: unknown) =>
        e instanceof OcrError &&
        e.message ===
          'This output option is not available for this file. Choose another option or file.' &&
        e.code === 'invalid_purpose' &&
        e.retryable === false
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('the batch queue retries a malformed response that is marked retryable', async () => {
  const original = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts < 3) return new Response('not json', { status: 200 });
    return new Response(
      JSON.stringify({ pages: [{ index: 0, text: 'recovered', finish_reason: 'stop' }] }),
      { status: 200 }
    );
  }) as typeof fetch;
  try {
    const [result] = await recognizeWithRetries();
    assert.equal(result.status, 'fulfilled');
    if (result.status === 'fulfilled') assert.equal(result.value.pages[0].text, 'recovered');
    assert.equal(attempts, 3);
  } finally {
    globalThis.fetch = original;
  }
});

test('the batch queue retries 429 up to the limit and never retries 401', async () => {
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
    const [result] = await recognizeWithRetries();
    const reason = rejectionReason(result);
    assert.ok(reason instanceof OcrError && reason.code === 'rate_limited');
    assert.equal(attempts, 3);
  } finally {
    globalThis.fetch = original;
  }

  attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    return new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401 });
  }) as typeof fetch;
  try {
    const [result] = await recognizeWithRetries();
    const reason = rejectionReason(result);
    assert.ok(reason instanceof OcrError && reason.code === 'unauthorized');
    assert.equal(attempts, 1, '401 is not retried');
  } finally {
    globalThis.fetch = original;
  }
});

test('the batch queue does not retry recognition timeouts, 504, or lost connections', async () => {
  const original = globalThis.fetch;
  const cases: Array<{ label: string; response: () => Response | Promise<never>; code: string }> = [
    {
      label: 'recognition timeout',
      response: () =>
        new Response(
          JSON.stringify({
            error: { message: 'OCR did not finish in time', code: 'gateway_timeout_error' },
          }),
          { status: 200 }
        ),
      code: 'gateway_timeout_error',
    },
    {
      label: '504',
      response: () => new Response('{}', { status: 504 }),
      code: 'gateway_timeout',
    },
    {
      label: 'dropped connection',
      response: () => {
        throw new TypeError('Failed to fetch');
      },
      code: 'network',
    },
  ];

  try {
    for (const testCase of cases) {
      let attempts = 0;
      globalThis.fetch = (async () => {
        attempts += 1;
        return testCase.response();
      }) as typeof fetch;
      const [result] = await recognizeWithRetries();
      const reason = rejectionReason(result);
      assert.ok(
        reason instanceof OcrError && reason.code === testCase.code && reason.retryable === false
      );
      assert.equal(attempts, 1, `${testCase.label} is not retried`);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test('the batch queue still retries 503 with an exposed retry interval', async () => {
  const original = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    return new Response(JSON.stringify({ error: { message: 'busy' } }), {
      status: 503,
      headers: { 'Retry-After': '0' },
    });
  }) as typeof fetch;
  try {
    const [result] = await recognizeWithRetries();
    const reason = rejectionReason(result);
    assert.ok(reason instanceof OcrError && reason.code === 'service_busy');
    assert.equal(attempts, 3, '503 remains bounded-retryable');
  } finally {
    globalThis.fetch = original;
  }
});
