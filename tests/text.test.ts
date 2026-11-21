import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanOcrText,
  describeStats,
  hasTruncatedPages,
  resultToText,
  safeFileStem,
  toMarkdownExport,
  toPlainTextExport,
} from '../src/utils/format.js';
import type { FileItem, FileOcrResult } from '../src/services/api/types.js';
import { combinedText, pendingItems, richLayoutRetryItems, state } from '../src/app/state.js';

const cleaningCases: Array<[string, string, string]> = [
  [
    'documented box closing token',
    '<|ref|>Invoice<|/ref|><|box|>[[52, 40, 948, 96]]</|box|>\n\n' +
      'Total due: 1,234.56 USD.\nLine two.\n\n\n\n中文：你好，世界！',
    'Invoice\n\nTotal due: 1,234.56 USD.\nLine two.\n\n中文：你好，世界！',
  ],
  [
    'live box closing token',
    '<|ref|>text<|/ref|><|box|>[[31,191,522,341]]<|/box|> DeepSeek OCR format test \n' +
      '<|ref|>text<|/ref|><|box|>[[31,482,671,671]]<|/box|> Formats: PNG JPEG WebP GIF BMP TIFF',
    'DeepSeek OCR format test\nFormats: PNG JPEG WebP GIF BMP TIFF',
  ],
  ['documented ref closing token', '<|ref|>Title</|ref|> body', 'Title body'],
  ['live ref closing token', '<|ref|>Title<|/ref|> body', 'Title body'],
  [
    'unclosed box span',
    '<|ref|>text<|/ref|><|box|>[[10,20,30,40]] Heading with coordinates',
    'Heading with coordinates',
  ],
  [
    'recognized text inside ref tokens',
    '<|ref|>Invoice<|/ref|> total and <|ref|>客户名称<|/ref|> detail',
    'Invoice total and 客户名称 detail',
  ],
  [
    'lowercase legacy text inside ref tokens',
    '<|ref|>invoice<|/ref|><|box|>[[1,2,3,4]]</|box|> total',
    'invoice total',
  ],
  [
    'live fullwidth role and box',
    '<｜ref｜>text<｜/ref｜><｜box｜>[[49,138,227,200]]<｜/box｜> Quarterly Report',
    'Quarterly Report',
  ],
  [
    'live fullwidth table role',
    '<｜ref｜>table<｜/ref｜><｜box｜>[[1,2,3,4]]<｜/box｜> ' +
      '<table><tr><td>Metric</td><td>Target</td></tr>' +
      '<tr><td>Error rate</td><td>&lt; 1%</td></tr></table>',
    '| Metric | Target |\n| --- | --- |\n| Error rate | < 1% |',
  ],
  [
    'live code role',
    '<｜ref｜>code<｜/ref｜><｜box｜>[[1,2,3,4]]<｜/box｜> status = ok',
    'status = ok',
  ],
  ['role-only image page', '<｜ref｜>image<｜/ref｜><｜box｜>[[0,0,999,999]]<｜/box｜>', ''],
  ['private-use bullet', '\nQueue latency is below 200 ms.', '- Queue latency is below 200 ms.'],
];

test('cleanOcrText removes layout tokens while preserving recognized text', () => {
  for (const [label, raw, expected] of cleaningCases) {
    assert.equal(cleanOcrText(raw), expected, label);
  }
});

test('cleanOcrText is safe on plain text and empty input', () => {
  assert.equal(cleanOcrText('Hello, world!'), 'Hello, world!');
  assert.equal(cleanOcrText(''), '');
  assert.equal(cleanOcrText('  a  \n\n\n b  '), 'a\n\n b');
});

test('cleanOcrText handles degenerate trailing whitespace in linear time', () => {
  const input = ' '.repeat(100_000) + 'x';
  const started = performance.now();
  assert.equal(cleanOcrText(input), 'x');
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1_000, `cleanup took ${elapsed.toFixed(0)}ms`);
});

test('resultToText joins pages and removes layout tokens', () => {
  const result: FileOcrResult = {
    pages: [
      { index: 0, text: '<|ref|>Heading<|/ref|>\n\nBody.', finishReason: 'stop' },
      { index: 1, text: 'Second page.', finishReason: 'stop' },
    ],
  };
  assert.equal(resultToText(result), 'Heading\n\nBody.\n\nSecond page.');
  assert.equal(hasTruncatedPages([result]), false);
});

test('source identifiers remain in extracted text and exports', () => {
  const result: FileOcrResult = {
    pages: [
      {
        index: 0,
        text: 'Invoice ID: INV-2026-001\nTotal: 42.00',
        finishReason: 'stop',
      },
    ],
  };
  const text = resultToText(result);
  assert.equal(text, 'Invoice ID: INV-2026-001\nTotal: 42.00');
  assert.equal(toPlainTextExport(text), 'Invoice ID: INV-2026-001\nTotal: 42.00\n');
  assert.equal(
    toMarkdownExport('invoice', text),
    '# invoice\n\nInvoice ID: INV-2026-001\nTotal: 42.00\n'
  );
});

test('the combined view preserves only source text', () => {
  const original = state.items;
  const item: FileItem = {
    id: 'item-1',
    name: 'invoice.png',
    size: 1,
    mimeType: 'image/png',
    blob: new Blob(['x']),
    previewUrl: '',
    rotation: 0,
    status: 'done',
    purpose: 'text_recognition',
    error: null,
    result: {
      pages: [{ index: 0, text: 'Invoice ID: INV-2026-001', finishReason: 'stop' }],
    },
    editedText: null,
  };
  state.items = [item];
  try {
    assert.equal(combinedText(), '## invoice.png\n\nInvoice ID: INV-2026-001');
  } finally {
    state.items = original;
  }
});

test('pendingItems excludes completed results', () => {
  const original = state.items;
  const make = (id: string, status: FileItem['status']): FileItem => ({
    id,
    name: `${id}.png`,
    size: 1,
    mimeType: 'image/png',
    blob: new Blob(['x']),
    previewUrl: '',
    rotation: 0,
    status,
    purpose: null,
    error: null,
    result: null,
    editedText: null,
  });
  state.items = [
    make('done', 'done'),
    make('ready', 'ready'),
    make('error', 'error'),
    make('cancelled', 'cancelled'),
  ];
  try {
    assert.deepEqual(
      pendingItems().map((item) => item.id),
      ['ready', 'error', 'cancelled']
    );
  } finally {
    state.items = original;
  }
});

test('Rich retry targets only truncated Standard results in the active view', () => {
  const originalItems = state.items;
  const originalActive = state.activeId;
  const make = (
    id: string,
    purpose: FileItem['purpose'],
    finishReason: FileOcrResult['pages'][number]['finishReason']
  ): FileItem => ({
    id,
    name: `${id}.png`,
    size: 1,
    mimeType: 'image/png',
    blob: new Blob(['x']),
    previewUrl: '',
    rotation: 0,
    status: 'done',
    purpose,
    error: null,
    result: { pages: [{ index: 0, text: 'text', finishReason }] },
    editedText: null,
  });
  state.items = [
    make('rich-truncated', 'rich_layout_recognition', 'length'),
    make('standard-truncated', 'text_recognition', 'length'),
    make('standard-complete', 'text_recognition', 'stop'),
  ];
  try {
    state.activeId = 'all';
    assert.deepEqual(
      richLayoutRetryItems().map((item) => item.id),
      ['standard-truncated']
    );

    state.activeId = 'rich-truncated';
    assert.deepEqual(richLayoutRetryItems(), []);

    state.activeId = 'standard-truncated';
    assert.deepEqual(
      richLayoutRetryItems().map((item) => item.id),
      ['standard-truncated']
    );

    state.activeId = 'standard-complete';
    assert.deepEqual(richLayoutRetryItems(), []);
  } finally {
    state.items = originalItems;
    state.activeId = originalActive;
  }
});

test('truncated pages are detected', () => {
  const result: FileOcrResult = {
    pages: [{ index: 0, text: 'partial', finishReason: 'length' }],
  };
  assert.equal(hasTruncatedPages([result]), true);
});

test('export helpers preserve unicode and produce valid filenames', () => {
  assert.equal(toPlainTextExport('Line\n'), 'Line\n');
  assert.equal(toMarkdownExport('My Scan', 'Line'), '# My Scan\n\nLine\n');
  assert.equal(safeFileStem('my scan (1).PNG'), 'my-scan-1');
  assert.equal(safeFileStem('!!!'), 'ocr-output');
  assert.equal(safeFileStem('报告 (1).PNG'), '报告-1');
  assert.match(describeStats('hello world\n中文'), /characters · .* words · 2 lines/);
  assert.equal(describeStats(''), '0 characters · 0 words · 0 lines');
  assert.equal(describeStats('word'), '4 characters · 1 word · 1 line');
});
