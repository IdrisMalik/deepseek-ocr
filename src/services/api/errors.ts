/** OCR error type and response parsing shared by the browser-only client. */
import { resultToText } from '../../utils/format.js';
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

/** Retry policy predicate for OCR errors. */
export const isRetryableOcrError = (error: unknown): boolean =>
  error instanceof OcrError && error.retryable;

/** Server-provided retry interval, when the provider exposed one through CORS. */
export const ocrRetryAfterMs = (error: unknown): number | undefined =>
  error instanceof OcrError ? error.retryAfterMs : undefined;

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

const TIMEOUT_MESSAGE = 'Text extraction took too long. Try a smaller file or split the document.';
const NON_RETRYABLE_BODY_MESSAGE = /password|parse|format|decoded|1000 pages|too large/i;

/** Map known provider wording to plain-language equivalents. */
const DOCUMENTED_BODY_MESSAGES: Array<[RegExp, string]> = [
  [/password-protected/i, 'This file is password-protected. Remove the password and try again.'],
  [
    /could not be parsed|format is not supported|image could not be decoded/i,
    'This file could not be read. Check that it is a supported format and is not damaged, then try again.',
  ],
  [/more than 1000 pages/i, 'This document has more than 1,000 pages. Use a shorter document.'],
  [/too large/i, 'This file is larger than the 100 MiB limit. Choose a smaller file.'],
  [
    /unsupported purpose/i,
    'This output option is not available for this file. Choose another option or file.',
  ],
  [/temporarily unavailable/i, 'DeepSeek is busy right now. Try again shortly.'],
  [/internal server error/i, 'DeepSeek had a temporary problem. Try again.'],
];

const HTTP_ERRORS: Record<number, { message: string; code: string; retryable: boolean }> = {
  400: {
    message: 'This file could not be processed. Check that it is a supported format and try again.',
    code: 'invalid_request',
    retryable: false,
  },
  401: {
    message: 'That API key is not valid. Check it in API key settings.',
    code: 'unauthorized',
    retryable: false,
  },
  402: {
    message: 'Your DeepSeek account balance is too low. Add funds and try again.',
    code: 'insufficient_balance',
    retryable: false,
  },
  403: {
    message: 'This API key does not have access to DeepSeek OCR.',
    code: 'forbidden',
    retryable: false,
  },
  408: {
    message: 'The upload took too long. Check your connection and try again.',
    code: 'upload_timeout',
    retryable: true,
  },
  413: {
    message: 'This file is larger than the 100 MiB limit. Choose a smaller file.',
    code: 'file_too_large',
    retryable: false,
  },
  429: {
    message: 'Too many requests right now. Wait a moment and try again.',
    code: 'rate_limited',
    retryable: true,
  },
  500: {
    message: 'DeepSeek could not process this file. Try again.',
    code: 'provider_error',
    retryable: true,
  },
  503: {
    message: 'DeepSeek is busy right now. Try again shortly.',
    code: 'service_busy',
    retryable: true,
  },
  504: { message: TIMEOUT_MESSAGE, code: 'gateway_timeout', retryable: false },
};

function friendlyProviderMessage(message: string): string {
  for (const [pattern, replacement] of DOCUMENTED_BODY_MESSAGES) {
    if (pattern.test(message)) return replacement;
  }
  return message;
}

function incompleteResult(): OcrError {
  return new OcrError('DeepSeek returned an incomplete result. Try again.', {
    code: 'bad_response',
    retryable: true,
  });
}

/** Map HTTP statuses to actionable messages and retryability. */
export function mapHttpError(
  status: number,
  body: unknown,
  headers?: { get(name: string): string | null }
): OcrError {
  const details = asErrorLike(body);
  const providerMessage = stringField(details.message);
  const providerCode = stringField(details.code);

  const mapped = HTTP_ERRORS[status] ?? {
    message: providerMessage
      ? friendlyProviderMessage(providerMessage)
      : 'DeepSeek reported an unexpected error. Try again.',
    code: providerCode ?? `http_${status}`,
    retryable: status >= 500,
  };

  // Browsers only expose Retry-After when the server opts in through CORS.
  // The queue still applies exponential backoff when it is unavailable.
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
export function parseOcrResponse(body: string): FileOcrResult {
  const trimmed = body.replace(/^\s+/, '');
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Response is not an object.');
    }
    data = parsed as Record<string, unknown>;
  } catch {
    throw new OcrError('Could not read the response from DeepSeek. Try again.', {
      code: 'bad_response',
      retryable: true,
    });
  }

  if (data.error !== undefined) {
    const embedded = asErrorLike(data);
    const message =
      stringField(embedded.message) ?? 'DeepSeek could not extract text from this file.';
    const code = stringField(embedded.code) ?? stringField(embedded.type) ?? 'provider_error';
    const isTimeout =
      code === 'gateway_timeout_error' ||
      /did not finish (?:in time|within 180 seconds)/i.test(message);
    if (isTimeout) {
      throw new OcrError(TIMEOUT_MESSAGE, { code: 'gateway_timeout_error', retryable: false });
    }
    const nonRetryable = NON_RETRYABLE_BODY_MESSAGE.test(message);
    throw new OcrError(friendlyProviderMessage(message), { code, retryable: !nonRetryable });
  }

  const rawPages = data.pages;
  if (!Array.isArray(rawPages) || rawPages.length === 0) {
    throw new OcrError('DeepSeek returned no pages. Try again or choose another file.', {
      code: 'empty_response',
      retryable: true,
    });
  }

  if (typeof data.page_count === 'number' && data.page_count !== rawPages.length) {
    throw incompleteResult();
  }

  const seen = new Set<number>();
  const pages: PageResult[] = rawPages.map((raw) => {
    const page = (raw ?? {}) as Record<string, unknown>;
    if (
      typeof page.index !== 'number' ||
      !Number.isInteger(page.index) ||
      page.index < 0 ||
      page.index >= rawPages.length
    ) {
      throw incompleteResult();
    }
    if (seen.has(page.index)) throw incompleteResult();
    seen.add(page.index);
    if (typeof page.text !== 'string') throw incompleteResult();
    const finish =
      page.finish_reason === 'length'
        ? 'length'
        : page.finish_reason === 'stop'
          ? 'stop'
          : 'unknown';
    return {
      index: page.index,
      text: page.text,
      finishReason: finish,
    };
  });

  // Preserve page order even if a provider response arrives out of order.
  pages.sort((a, b) => a.index - b.index);

  // Judge emptiness by the cleaned text: markup-only pages (roles, boxes, HTML)
  // carry no recoverable words even though the raw text is not blank.
  if (!resultToText({ pages }).trim()) {
    throw new OcrError('No text was found. Try again, or choose a clearer image or document.', {
      code: 'empty_result',
      retryable: false,
    });
  }

  return { pages };
}
