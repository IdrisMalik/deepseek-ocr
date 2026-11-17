import test from 'node:test';
import assert from 'node:assert/strict';
import { clientConfig } from '../src/utils/config.js';
import { MAX_FILES, MAX_FILE_BYTES } from '../src/services/files.js';

test('file limits share the single configuration source', () => {
  assert.equal(MAX_FILES, clientConfig.maxFiles);
  assert.equal(MAX_FILE_BYTES, clientConfig.maxFileBytes);
});

test('OCR batch settings stay within the verified service constraints', () => {
  // Official OCR limit: 15 recognitions in progress per account.
  assert.ok(clientConfig.concurrency >= 1 && clientConfig.concurrency <= 15);
  assert.ok(clientConfig.maxAttempts >= 1 && clientConfig.maxAttempts <= 3);
  assert.ok(MAX_FILE_BYTES <= 100 * 1024 * 1024);
});
