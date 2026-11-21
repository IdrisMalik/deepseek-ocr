import test from 'node:test';
import assert from 'node:assert/strict';
import { clientConfig } from '../src/utils/config.js';

test('OCR batch settings stay within service and retry limits', () => {
  // Official cap: 15 OCR recognitions in progress per account.
  assert.ok(clientConfig.concurrency >= 1 && clientConfig.concurrency <= 15);
  assert.ok(clientConfig.maxAttempts >= 1 && clientConfig.maxAttempts <= 3);
  assert.ok(clientConfig.maxFileBytes <= 100 * 1024 * 1024);
});
