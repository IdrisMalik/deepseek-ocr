import { clientConfig, demoMode } from '../../utils/config.js';
import { mapHttpError, OcrError, parseOcrResponse } from './errors.js';
import type { ApiErrorPayload, FileOcrResult, OcrPurpose } from './types.js';

async function parseError(response: Response, body?: string): Promise<OcrError> {
  let payload: ApiErrorPayload = {};
  try {
    payload = JSON.parse(body ?? (await response.text())) as ApiErrorPayload;
  } catch {
    // Fall back to the status mapping when the body is not JSON.
  }
  return mapHttpError(response.status, payload, response.headers);
}

export type OcrFileInput = { name: string; blob: Blob };

const REQUEST_TIMEOUT_MINUTES = Math.max(1, Math.round(clientConfig.requestTimeoutMs / 60_000));

/**
 * Combine the caller's signal with a hard timeout and clean up the timer and
 * listener when the request settles.
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

async function postOcrOnce(
  file: OcrFileInput,
  purpose: OcrPurpose,
  key: string,
  signal: AbortSignal
): Promise<FileOcrResult> {
  const combined = combineWithTimeout(signal, clientConfig.requestTimeoutMs);

  const form = new FormData();
  form.append('purpose', purpose);
  form.append('file', file.blob, file.name);

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
    if (signal.aborted) throw new OcrError('Cancelled.', { code: 'cancelled', retryable: false });
    if (combined.timedOut()) {
      throw new OcrError(
        `Text extraction took too long (over ${REQUEST_TIMEOUT_MINUTES} minutes). Try a smaller file or split the document.`,
        { code: 'timeout', retryable: false }
      );
    }
    // The request may have reached DeepSeek before the connection failed.
    // Automatic retries could bill the same file twice, so leave this to the
    // user's manual Retry action.
    throw new OcrError(
      'Connection lost. DeepSeek may still be processing this file. Check your account before trying again to avoid a duplicate charge.',
      { code: 'network', retryable: false }
    );
  } finally {
    combined.dispose();
  }

  if (!response.ok) throw await parseError(response, body);
  return parseOcrResponse(body);
}

function demoResult(file: OcrFileInput): FileOcrResult {
  const safeName = file.name.replace(/[<>]/g, '');
  return {
    pages: [
      {
        index: 0,
        text: [
          `<|ref|>${safeName}<|/ref|><|box|>[[40,30,700,80]]<|/box|>`,
          'Demo mode — sample text. No API key was used and nothing was sent to DeepSeek.',
          '',
          'Paragraph structure and multilingual text — 你好，世界！',
        ].join('\n'),
        finishReason: 'stop',
      },
    ],
  };
}

/** One OCR request for one file; the batch queue owns retry policy. */
export async function recognizeFileOnce(
  file: OcrFileInput,
  purpose: OcrPurpose,
  key: string,
  signal: AbortSignal
): Promise<FileOcrResult> {
  if (demoMode()) return demoResult(file);
  if (!key)
    throw new OcrError('Add your DeepSeek API key to extract text.', {
      code: 'no_key',
      retryable: false,
    });
  return postOcrOnce(file, purpose, key, signal);
}

/** Verify a user-provided key with GET /models. */
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
    throw new OcrError(
      timedOut
        ? 'Checking the API key took too long. Try again.'
        : 'Could not reach DeepSeek. Check your connection and try again.',
      { code: timedOut ? 'timeout' : 'network', retryable: true }
    );
  }

  if (!response.ok) {
    const mapped = await parseError(response);
    const knownKeyStatus =
      response.status === 401 ||
      response.status === 402 ||
      response.status === 403 ||
      response.status === 429;
    if (knownKeyStatus) throw mapped;
    throw new OcrError('Could not check the API key. Try again later.', {
      code: mapped.code,
      retryable: mapped.retryable,
      status: mapped.status,
      retryAfterMs: mapped.retryAfterMs,
    });
  }
}
