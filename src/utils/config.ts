/** Static configuration for the browser-only (GitHub Pages) build. */
export const clientConfig = {
  ocrUrl: 'https://api.deepseek.com/v1/tools/ocr',
  verifyUrl: 'https://api.deepseek.com/models',
  maxFiles: 20,
  maxFileBytes: 100 * 1024 * 1024,
  // Official OCR limit: 15 recognitions in progress per account, separate from
  // chat models. Stay below it to leave headroom for other clients using the key.
  concurrency: 6,
  // At most 3 OCR attempts per file (first attempt + 2 retries).
  maxAttempts: 3,
  retryBaseMs: 500,
  retryMaxMs: 8_000,
  retryMaxRetryAfterMs: 30_000,
  retryJitterRatio: 0.25,
  requestTimeoutMs: 180_000,
  keyStorageName: 'deepseek-ocr:api-key',
} as const;

/** Demo mode via ?demo=1 — deterministic local responses, no API key or cost. */
export const demoMode = (): boolean =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';
