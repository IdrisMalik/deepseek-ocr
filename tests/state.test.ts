import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginExtraction,
  cancelExtraction,
  commitExtraction,
  failExtraction,
  resetForInputChange,
} from '../src/app/extractionTransitions.js';
import {
  pendingItems,
  restoreApiKey,
  richLayoutRetryItems,
  state,
  successfulItems,
} from '../src/app/state.js';
import { clientConfig } from '../src/utils/config.js';
import type { FileItem, FileOcrResult } from '../src/services/api/types.js';

const result = (text: string, finishReason: 'stop' | 'length' = 'stop'): FileOcrResult => ({
  pages: [{ index: 0, text, finishReason }],
});

function item(overrides: Partial<FileItem> = {}): FileItem {
  const id = overrides.id ?? 'file-1';
  return {
    id,
    name: overrides.name ?? `${id}.png`,
    size: 1,
    mimeType: 'image/png',
    blob: new Blob(['x']),
    previewUrl: '',
    rotation: 0,
    status: 'ready',
    purpose: null,
    error: null,
    result: null,
    editedText: null,
    ...overrides,
  };
}

test('a failed retry preserves the last committed result and edit', () => {
  const committed = result('committed', 'length');
  const file = item({
    status: 'done',
    purpose: 'text_recognition',
    result: committed,
    editedText: 'edited text',
    error: 'old error',
  });

  beginExtraction(file);
  assert.equal(file.status, 'ready');
  assert.equal(file.error, null);
  assert.equal(file.result, committed);
  assert.equal(file.purpose, 'text_recognition');
  assert.equal(file.editedText, 'edited text');

  failExtraction(file, 'retry failed');
  assert.equal(file.status, 'error');
  assert.equal(file.error, 'retry failed');
  assert.equal(file.result, committed);
  assert.equal(file.purpose, 'text_recognition');
  assert.equal(file.editedText, 'edited text');
});

test('a cancelled retry preserves the last committed result and edit', () => {
  const committed = result('committed');
  const file = item({
    status: 'done',
    purpose: 'rich_layout_recognition',
    result: committed,
    editedText: 'edited text',
  });

  beginExtraction(file);
  cancelExtraction(file);

  assert.equal(file.status, 'cancelled');
  assert.equal(file.error, null);
  assert.equal(file.result, committed);
  assert.equal(file.purpose, 'rich_layout_recognition');
  assert.equal(file.editedText, 'edited text');
});

test('a successful attempt replaces the committed result and clears the edit', () => {
  const previous = result('previous');
  const next = result('next', 'length');
  const file = item({
    status: 'error',
    purpose: 'text_recognition',
    result: previous,
    editedText: 'edited text',
    error: 'retry failed',
  });

  beginExtraction(file);
  commitExtraction(file, next, 'rich_layout_recognition');

  assert.equal(file.status, 'done');
  assert.equal(file.error, null);
  assert.equal(file.result, next);
  assert.equal(file.purpose, 'rich_layout_recognition');
  assert.equal(file.editedText, null);
});

test('an input change clears the committed extraction', () => {
  const file = item({
    status: 'error',
    purpose: 'text_recognition',
    result: result('previous'),
    editedText: 'edited text',
    error: 'retry failed',
  });

  resetForInputChange(file);

  assert.equal(file.status, 'ready');
  assert.equal(file.error, null);
  assert.equal(file.result, null);
  assert.equal(file.purpose, null);
  assert.equal(file.editedText, null);
});

test('the persisted key is restored explicitly rather than at module import', () => {
  const store = new Map<string, string>();
  const storage = {
    get length(): number {
      return store.size;
    },
    clear: (): void => store.clear(),
    getItem: (key: string): string | null => store.get(key) ?? null,
    key: (index: number): string | null => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string): void => {
      store.delete(key);
    },
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
  } as Storage;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousKey = state.apiKey;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  try {
    store.set(clientConfig.keyStorageName, 'sk-restored');
    restoreApiKey();
    assert.equal(state.apiKey, 'sk-restored');
  } finally {
    state.apiKey = previousKey;
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('committed output stays visible and retryable after a failed attempt', () => {
  const originalItems = state.items;
  const originalActive = state.activeId;
  const failed = item({
    id: 'failed',
    status: 'error',
    purpose: 'text_recognition',
    result: result('partial', 'length'),
    editedText: 'edited text',
    error: 'retry failed',
  });
  const complete = item({
    id: 'complete',
    status: 'done',
    purpose: 'text_recognition',
    result: result('complete'),
  });

  state.items = [failed, complete];
  try {
    state.activeId = 'all';
    assert.deepEqual(
      successfulItems().map((candidate) => candidate.id),
      ['failed', 'complete']
    );
    assert.deepEqual(
      pendingItems().map((candidate) => candidate.id),
      ['failed']
    );
    assert.deepEqual(
      richLayoutRetryItems().map((candidate) => candidate.id),
      ['failed']
    );

    state.activeId = 'failed';
    assert.deepEqual(
      richLayoutRetryItems().map((candidate) => candidate.id),
      ['failed']
    );

    state.activeId = 'complete';
    assert.deepEqual(richLayoutRetryItems(), []);
  } finally {
    state.items = originalItems;
    state.activeId = originalActive;
  }
});
