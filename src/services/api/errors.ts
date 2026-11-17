/** OCR error type and response parsing shared by the browser-only client. */
import { parseRetryAfter } from '../../utils/retry.js';
import type { FileOcrResult, PageResult } from './types.js';

export class OcrError extends Error {
  code: string;
  retryable: boolean;
  status: number | null;
  retryAfterMs?: number;

  constructor(
    message: string,
    options: { code: string; retryable: boolean; status?: number | null; retryAfterMs?: number }
  ) {
    super(message);
    this.name = 'OcrError';
    this.code = options.code;
    this.retryable = options.retryable;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs;
  }
}

type ErrorLike = { message?: unknown; code?: unknown; type?: unknown };

function asErrorLike(value: unknown): ErrorLike {
  if (value && typeof value === 'object' && 'error' in value) {
    const inner = (value as { error?: unknown }).error;
    if (inner && typeof inner === 'object') return inner as ErrorLike;
  }
  if (value && typeof value === 'object') return value as ErrorLike;
  return {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Map documented DeepSeek OCR HTTP statuses to actionable messages. */
export function mapHttpError(
  status: number,
  body: unknown,
  headers?: { get(name: string): string | null }
): OcrError {
  const details = asErrorLike(body);
  const providerMessage = stringField(details.message);
  const providerCode = stringField(details.code);

  const table: Record<number, { message: string; code: string; retryable: boolean }> = {
    400: { message: 'Could not process this file. Check the format and try again.', code: 'invalid_request', retryable: false },
    401: { message: 'Invalid API key. Check it in API key settings.', code: 'unauthorized', retryable: false },
    402: { message: 'Insufficient balance. Top up your account and try again.', code: 'insufficient_balance', retryable: false },
    403: { message: 'This API key cannot access the OCR API.', code: 'forbidden', retryable: false },
    408: { message: 'Upload timed out. Check your connection and try again.', code: 'upload_timeout', retryable: true },
    413: { message: 'This file is larger than the 100 MB limit. Choose a smaller file.', code: 'file_too_large', retryable: false },
    429: { message: 'Too many requests. Try again later.', code: 'rate_limited', retryable: true },
    500: { message: 'DeepSeek could not process the file. Try again.', code: 'provider_error', retryable: true },
    503: { message: 'DeepSeek is busy. Try again shortly.', code: 'service_busy', retryable: true },
    504: { message: 'The request timed out. Try again or use a smaller file.', code: 'gateway_timeout', retryable: true },
  };

  const mapped = table[status] ?? {
    message: providerMessage ?? `DeepSeek returned an unexpected error (${status}). Try again.`,
    code: providerCode ?? `http_${status}`,
    retryable: status >= 500,
  };

  const retryAfterMs =
    mapped.retryable && (status === 429 || status === 503)
      ? parseRetryAfter(headers?.get('retry-after') ?? undefined)
      : undefined;

  return new OcrError(mapped.message, {
    code: providerCode ?? mapped.code,
    retryable: mapped.retryable,
    status,
    retryAfterMs,
  });
}

/** Parse the JSON response, including leading keep-alive newlines. */
export function parseOcrResponse(body: string, fallbackName: string): FileOcrResult {
  const trimmed = body.replace(/^\s+/, '');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    throw new OcrError('Could not read DeepSeek’s response. Try again.', {
      code: 'bad_response',
      retryable: true,
    });
  }

  const embedded = asErrorLike(data);
  if (data.error !== undefined) {
    const message = stringField(embedded.message) ?? 'DeepSeek could not extract text from this file.';
    const code = stringField(embedded.code) ?? stringField(embedded.type) ?? 'provider_error';
    const nonRetryable = /password|parse|format|decoded|1000 pages|too large/i.test(message);
    throw new OcrError(message, { code, retryable: !nonRetryable });
  }

  if (!Array.isArray(data.pages) || data.pages.length === 0) {
    throw new OcrError('No pages were returned. Try again or choose another file.', {
      code: 'empty_response',
      retryable: true,
    });
  }

  const pages: PageResult[] = data.pages.map((raw, index) => {
    const page = (raw ?? {}) as Record<string, unknown>;
    if (typeof page.text !== 'string') {
      throw new OcrError('DeepSeek returned an incomplete result. Try again.', {
        code: 'bad_response',
        retryable: true,
      });
    }
    const finish = page.finish_reason === 'length' ? 'length' : page.finish_reason === 'stop' ? 'stop' : 'unknown';
    return { index: typeof page.index === 'number' ? page.index : index, text: page.text, finishReason: finish };
  });

  if (pages.every((page) => page.text.trim() === '')) {
    throw new OcrError(
      'No text was found. Try a clearer file.',
      { code: 'empty_result', retryable: false }
    );
  }

  const usage = (data.usage ?? {}) as Record<string, unknown>;
  return {
    name: fallbackName,
    pages,
    inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
    outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
  };
}
