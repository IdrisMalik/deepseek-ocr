/**
 * Headless OCR batch execution: composes the work queue, upload preparation,
 * and the OCR client. State transitions use the shared helpers in `state.ts`;
 * rendering, translations, and active-result selection stay in the app shell.
 */
import { recognizeFileOnce, type OcrFileInput } from '../services/api/client.js';
import { isRetryableOcrError, ocrRetryAfterMs } from '../services/api/errors.js';
import { prepareUpload, type PreparedUpload } from '../services/files.js';
import type { FileItem, FileOcrResult, OcrPurpose } from '../services/api/types.js';
import { clientConfig } from '../utils/config.js';
import { mapWithRetries, type QueueOptions } from '../utils/queue.js';
import { cancelExtraction, commitExtraction, failExtraction } from './state.js';

/** Test-only overrides for production retry limits and delays. */
export type OcrRetryOverrides = {
  concurrency?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxRetryAfterMs?: number;
  jitterRatio?: number;
};

export type OcrQueuePolicy = Omit<QueueOptions<FileOcrResult>, 'signal' | 'onTerminal'>;

/** Build the queue policy from configuration so app and tests use one source. */
export function createOcrQueueOptions(overrides: OcrRetryOverrides = {}): OcrQueuePolicy {
  return {
    concurrency: overrides.concurrency ?? clientConfig.concurrency,
    maxAttempts: overrides.maxAttempts ?? clientConfig.maxAttempts,
    baseDelayMs: overrides.baseDelayMs ?? clientConfig.retryBaseMs,
    maxDelayMs: overrides.maxDelayMs ?? clientConfig.retryMaxMs,
    maxRetryAfterMs: overrides.maxRetryAfterMs ?? clientConfig.retryMaxRetryAfterMs,
    jitterRatio: overrides.jitterRatio ?? clientConfig.retryJitterRatio,
    isRetryable: isRetryableOcrError,
    getRetryAfterMs: ocrRetryAfterMs,
  };
}

export type OcrBatchOptions = {
  /** Items already queued by the caller; committed results are preserved. */
  items: readonly FileItem[];
  purpose: OcrPurpose;
  apiKey: string;
  signal: AbortSignal;
  /** Required so user-facing fallback wording stays in the presentation layer. */
  formatError: (error: unknown) => string;
  prepare?: (item: FileItem) => Promise<PreparedUpload>;
  recognize?: (
    file: OcrFileInput,
    purpose: OcrPurpose,
    key: string,
    signal: AbortSignal
  ) => Promise<FileOcrResult>;
  retry?: OcrRetryOverrides;
  /** Fires when an item starts processing and when its attempt reaches a terminal state. */
  onItemChange?: (item: FileItem) => void;
  /** Fires once per item after its terminal outcome is applied. */
  onProgress?: (done: number, total: number, aborted: boolean) => void;
};

export type OcrBatchSummary = {
  cancelled: boolean;
  /** Items whose latest attempt ended in an error, in input order. */
  failures: FileItem[];
};

/**
 * Run one attempt per item, with queue-owned retries. Every normally settled
 * item receives a terminal state before this resolves; on abort, items that
 * never settled are marked cancelled. The caller still owns progress labels,
 * error presentation, and UI state such as the active result.
 */
export async function runOcrBatch(options: OcrBatchOptions): Promise<OcrBatchSummary> {
  const {
    items,
    purpose,
    apiKey,
    signal,
    formatError,
    prepare = prepareUpload,
    recognize = recognizeFileOnce,
    retry,
    onItemChange,
    onProgress,
  } = options;
  const total = items.length;
  const failures = new Set<FileItem>();
  let done = 0;
  let cancelled = false;

  await mapWithRetries(
    items,
    async (item): Promise<FileOcrResult> => {
      item.status = 'processing';
      onItemChange?.(item);
      const upload = await prepare(item);
      return recognize({ name: upload.filename, blob: upload.blob }, purpose, apiKey, signal);
    },
    {
      ...createOcrQueueOptions(retry),
      signal,
      onTerminal: (index, outcome) => {
        const item = items[index];
        if (outcome.status === 'fulfilled') {
          commitExtraction(item, outcome.value, purpose);
        } else {
          failures.add(item);
          failExtraction(item, formatError(outcome.reason));
        }
        done += 1;
        onProgress?.(done, total, signal.aborted);
        onItemChange?.(item);
      },
    }
  );

  // The queue does not report an outcome for aborted work; finalize every item
  // that never settled so no target is left ready or processing.
  if (signal.aborted) {
    for (const item of items) {
      if (item.status === 'ready' || item.status === 'processing') {
        cancelExtraction(item);
        cancelled = true;
      }
    }
  }

  return {
    cancelled,
    failures: items.filter((item) => failures.has(item)),
  };
}
