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
import type { FileOcrResult } from '../src/services/api/types.js';

test('cleanOcrText removes layout tokens but keeps reading order and paragraphs', () => {
  const raw =
    '<｜ref｜>Invoice<｜/ref｜><｜box｜>[[52, 40, 948, 96]]</｜box｜>\n\n' +
    'Total due: 1,234.56 USD.\nLine two.\n\n\n\n中文：你好，世界！';
  const expected = 'Invoice\n\nTotal due: 1,234.56 USD.\nLine two.\n\n中文：你好，世界！';
  assert.equal(cleanOcrText(raw), expected);
});

test('cleanOcrText removes live Rich Layout box tokens (<｜/box｜> closing form)', () => {
  // Exact shape returned by the live API in rich_layout_recognition mode.
  const raw =
    '<｜ref｜>text<｜/ref｜><｜box｜>[[31,191,522,341]]<｜/box｜> DeepSeek OCR format test \n' +
    '<｜ref｜>text<｜/ref｜><｜box｜>[[31,482,671,671]]<｜/box｜> Formats: PNG JPEG WebP GIF BMP TIFF';
  assert.equal(
    cleanOcrText(raw),
    'text DeepSeek OCR format test\ntext Formats: PNG JPEG WebP GIF BMP TIFF'
  );
});

test('cleanOcrText removes both documented and live box closing forms', () => {
  const documented = '<｜ref｜>Title<｜/ref｜><｜box｜>[[52, 40, 948, 96]]</｜box｜> Title text';
  const live = '<｜ref｜>Title<｜/ref｜><｜box｜>[[52, 40, 948, 96]]<｜/box｜> Title text';
  assert.equal(cleanOcrText(documented), 'Title Title text');
  assert.equal(cleanOcrText(live), 'Title Title text');
  assert.equal(cleanOcrText('<｜ref｜>Title</｜ref｜> body'), 'Title body');
  assert.equal(cleanOcrText('<｜ref｜>Title<｜/ref｜> body'), 'Title body');
});

test('cleanOcrText removes an unclosed box coordinate span', () => {
  const raw = '<｜ref｜>text<｜/ref｜><｜box｜>[[10,20,30,40]] Heading with coordinates';
  assert.equal(cleanOcrText(raw), 'text Heading with coordinates');
});

test('cleanOcrText is safe on plain text and empty input', () => {
  assert.equal(cleanOcrText('Hello, world!'), 'Hello, world!');
  assert.equal(cleanOcrText(''), '');
  assert.equal(cleanOcrText('  a  \n\n\n b  '), 'a\n\n b');
});

test('cleanOcrText keeps recognized text inside ref tokens', () => {
  const raw = '<｜ref｜>Invoice<｜/ref｜> total and <｜ref｜>客户名称<｜/ref｜> detail';
  assert.equal(cleanOcrText(raw), 'Invoice total and 客户名称 detail');
});

test('cleanOcrText handles degenerate trailing whitespace in linear time', () => {
  const input = ' '.repeat(100_000) + 'x';
  const started = performance.now();
  assert.equal(cleanOcrText(input), 'x');
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1_000, `cleanup took ${elapsed.toFixed(0)}ms`);
});

test('raw and clean views differ only by token cleanup', () => {
  const result: FileOcrResult = {
    name: 'scan.png',
    pages: [
      { index: 0, text: '<｜ref｜>Heading<｜/ref｜>\n\nBody.', finishReason: 'stop' },
      { index: 1, text: 'Second page.', finishReason: 'stop' },
    ],
  };
  assert.equal(resultToText(result, false), '<｜ref｜>Heading<｜/ref｜>\n\nBody.\n\nSecond page.');
  assert.equal(resultToText(result, true), 'Heading\n\nBody.\n\nSecond page.');
  assert.equal(hasTruncatedPages([result]), false);
});

test('truncated pages are detected', () => {
  const result: FileOcrResult = {
    name: 'long.png',
    pages: [{ index: 0, text: 'partial', finishReason: 'length' }],
  };
  assert.equal(hasTruncatedPages([result]), true);
});

test('export helpers preserve unicode and produce valid filenames', () => {
  assert.equal(toPlainTextExport('Line\n'), 'Line\n');
  assert.equal(toMarkdownExport('My Scan', 'Line'), '# My Scan\n\nLine\n');
  assert.equal(safeFileStem('my scan (1).PNG'), 'my-scan-1');
  assert.equal(safeFileStem('!!!'), 'ocr-output');
  assert.match(describeStats('hello world\n中文'), /characters · .* words · 2 lines/);
  assert.equal(describeStats(''), '0 characters · 0 words · 0 lines');
  assert.equal(describeStats('word'), '4 characters · 1 word · 1 line');
});
