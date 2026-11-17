import { clientConfig, demoMode } from '../../utils/config.js';
import { mapHttpError, parseOcrResponse } from './errors.js';
import { withRetry } from '../../utils/retry.js';
import type { ApiErrorPayload, FileOcrResult, OcrPurpose, OcrResponse } from './types.js';

export class OcrClientError extends Error {
  code: string;
  retryable: boolean;
  status: number | null;
  retryAfterMs?: number;

  constructor(
    message: string,
    options: { code: string; retryable: boolean; status?: number | null; retryAfterMs?: number }
  ) {
    super(message);
    this.name = 'OcrClientError';
    this.code = options.code;
    this.retryable = options.retryable;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs;
  }
}

async function parseError(response: Response, body?: string): Promise<OcrClientError> {
  let payload: ApiErrorPayload = {};
  try {
    payload = JSON.parse(body ?? (await response.text())) as ApiErrorPayload;
  } catch {
    // Non-JSON error bodies still deserve a useful message.
  }
  const e = mapHttpError(response.status, payload, response.headers);
  return new OcrClientError(e.message, {
    code: e.code,
    retryable: e.retryable,
    status: response.status,
    retryAfterMs: e.retryAfterMs,
  });
}

export type OcrFileInput = { name: string; mimeType: string; bytes: Uint8Array<ArrayBuffer> };

/**
 * Combine the caller's signal with a hard timeout without depending on
 * AbortSignal.any (Safari < 17.4). Also owns cleanup of the timeout and the
 * caller listener so finished requests do not leave timers behind.
 */
function combineWithTimeout(signal: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;

  const onAbort = (): void => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', onAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    },
  };
}

/** Convert a base64 data URL (from canvas preprocessing) to raw bytes. */
function dataUrlToBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function postOcrOnce(file: OcrFileInput, purpose: OcrPurpose, key: string, signal: AbortSignal): Promise<FileOcrResult> {
  const combined = combineWithTimeout(signal, clientConfig.requestTimeoutMs);

  const form = new FormData();
  form.append('purpose', purpose);
  form.append('file', new Blob([file.bytes], { type: file.mimeType }), file.name);

  let response: Response;
  let body: string;
  try {
    response = await fetch(clientConfig.ocrUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: combined.signal,
    });
    // The body is part of the request: cancellation and timeouts must apply
    // while it is still downloading, not only until headers arrive.
    body = await response.text();
  } catch {
    if (signal.aborted) throw new OcrClientError('Cancelled.', { code: 'cancelled', retryable: false });
    if (combined.timedOut()) throw new OcrClientError('Request timed out. Try again or use a smaller file.', { code: 'timeout', retryable: true });
    throw new OcrClientError(
      'Could not reach DeepSeek. Check your connection and try again.',
      { code: 'network', retryable: true }
    );
  } finally {
    combined.dispose();
  }

  if (!response.ok) throw await parseError(response, body);
  return parseOcrResponse(body, file.name);
}

function demoResult(file: OcrFileInput): FileOcrResult {
  const safeName = file.name.replace(/[<>]/g, '');
  return {
    name: file.name,
    pages: [{
      index: 0,
      text: [
        `<｜ref｜>${safeName}<｜/ref｜><｜box｜>[[40,30,700,80]]<｜/box｜>`,
        'Demo mode — sample output. No API key or API call was used.',
        '',
        'Paragraph structure and multilingual text — 你好，世界！',
      ].join('\n'),
      finishReason: 'stop',
    }],
  };
}

/** One OCR request for one file. The scheduler owns retry policy for batches. */
export async function recognizeFileOnce(
  file: OcrFileInput,
  purpose: OcrPurpose,
  key: string,
  signal: AbortSignal
): Promise<FileOcrResult> {
  if (demoMode()) return demoResult(file);
  if (!key) throw new OcrClientError('Add an API key to extract text.', { code: 'no_key', retryable: false });
  return postOcrOnce(file, purpose, key, signal);
}

/** Recognize a single file with bounded retries (for direct callers). */
export async function recognizeFile(
  file: OcrFileInput,
  purpose: OcrPurpose,
  key: string,
  signal: AbortSignal
): Promise<FileOcrResult> {
  return withRetry(() => recognizeFileOnce(file, purpose, key, signal), {
    signal,
    maxAttempts: clientConfig.maxAttempts,
    // Both OcrClientError (HTTP/network) and OcrError (malformed response)
    // expose `retryable`; checking the flag keeps response parsing retryable.
    isRetryable: (error) => error instanceof Error && Boolean((error as { retryable?: boolean }).retryable),
    getRetryAfterMs: (error) => (error instanceof OcrClientError ? error.retryAfterMs : undefined),
  });
}

/** Convert a preprocessing data URL into the byte payload used by recognizeFile. */
export function toOcrFile(name: string, dataUrl: string, mimeType: string): OcrFileInput {
  return { name, bytes: dataUrlToBytes(dataUrl), mimeType };
}

/** Verify a user-provided key with a free GET /models call. */
export async function verifyApiKey(key: string, signal?: AbortSignal): Promise<void> {
  if (demoMode()) return;

  let response: Response;
  try {
    response = await fetch(clientConfig.verifyUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      signal,
    });
  } catch {
    const timedOut =
      signal?.aborted && (signal.reason as { name?: string } | undefined)?.name === 'TimeoutError';
    throw new OcrClientError(
      timedOut
        ? 'Verification timed out. Try again.'
        : 'Could not reach DeepSeek. Check your connection and try again.',
      { code: timedOut ? 'timeout' : 'network', retryable: true }
    );
  }

  if (!response.ok) {
    const mapped = await parseError(response);
    const message =
      response.status === 401
        ? 'Invalid API key. Check it and try again.'
        : response.status === 403
          ? 'This API key cannot access the OCR API.'
          : response.status === 402
            ? 'Insufficient balance. Top up your account and try again.'
            : response.status === 429
              ? 'Too many requests. Try again later.'
              : 'Could not verify the key. Try again later.';
    throw new OcrClientError(message, {
      code: mapped.code,
      retryable: mapped.retryable,
      status: response.status,
      retryAfterMs: mapped.retryAfterMs,
    });
  }
}

export type { OcrResponse };
