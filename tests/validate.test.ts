import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyFileContent } from '../src/utils/validate.js';
import { acceptAttribute, kindForMime, SUPPORTED_FORMATS } from '../src/services/formats.js';
import { resolveMimeType, validateFile } from '../src/services/files.js';

const fixturePath = (name: string): string => join(process.cwd(), 'tests', 'fixtures', name);
const fixture = (name: string): File => new File([readFileSync(fixturePath(name))], name);

test('every advertised format validates from a representative fixture', () => {
  for (const format of SUPPORTED_FORMATS) {
    const candidate = [format.ext, ...(format.aliases ?? [])]
      .map((ext) => `sample.${ext}`)
      .find((name) => existsSync(fixturePath(name)));
    assert.ok(candidate, `fixture for ${format.label}`);
    const name = candidate!;
    const bytes = readFileSync(fixturePath(name));
    const file = new File([bytes], name);
    const mime = resolveMimeType(file);
    assert.equal(mime, format.mime, `mime for ${name}`);
    assert.equal(validateFile(file), null, `validation for ${name}`);
    verifyFileContent(new Uint8Array(bytes).slice(0, 128), mime, name, file.size);
  }
});

test('TIFF is classified as a document rather than a preview image', () => {
  const tiff = SUPPORTED_FORMATS.find((f) => f.label === 'TIFF');
  assert.ok(tiff);
  assert.equal(kindForMime(tiff!.mime), 'document');
});

test('accept attribute advertises every supported extension', () => {
  const accept = acceptAttribute();
  for (const format of SUPPORTED_FORMATS) {
    assert.ok(accept.includes(`.${format.ext}`));
    for (const alias of format.aliases ?? []) assert.ok(accept.includes(`.${alias}`));
  }
});

test('static file input fallback matches the generated accept list', () => {
  const html = readFileSync(join(process.cwd(), 'src', 'index.html'), 'utf8');
  const inputTag = /<input[^>]*id="fileInput"[^>]*>/.exec(html)?.[0];
  const accept = /accept="([^"]+)"/.exec(inputTag ?? '')?.[1];
  assert.ok(inputTag, 'fileInput element');
  assert.equal(accept, acceptAttribute());
});

test('validation rejects unsupported, empty and oversized files', () => {
  assert.match(validateFile(fixture('not-an-image.txt')) ?? '', /not a supported file type/);
  assert.match(validateFile(new File([], 'empty.png', { type: 'image/png' })) ?? '', /empty/);
  const big = new File([new Uint8Array(101 * 1024 * 1024)], 'big.png', { type: 'image/png' });
  assert.match(validateFile(big) ?? '', /100 MiB/);
});

test('content verification rejects malformed and mismatched files', () => {
  const malformed = new Uint8Array(
    readFileSync(join(process.cwd(), 'tests', 'fixtures', 'malformed.bin'))
  );
  assert.throws(() => verifyFileContent(malformed, 'application/pdf', 'fake.pdf'), /not a valid/);
  const png = new Uint8Array(
    readFileSync(join(process.cwd(), 'tests', 'fixtures', 'sample.png'))
  ).slice(0, 16);
  assert.throws(() => verifyFileContent(png, 'application/pdf', 'wrong.pdf'), /not a valid/);
});

test('content verification rejects generic ZIPs and malformed BMP headers', () => {
  const zip = new Uint8Array(64);
  zip.set([0x50, 0x4b, 0x03, 0x04]);
  zip[26] = 11;
  for (let i = 0; i < 11; i += 1) zip[30 + i] = 'payload.txt'.charCodeAt(i);
  assert.throws(
    () =>
      verifyFileContent(
        zip,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'fake.docx'
      ),
    /not a valid/
  );

  const bmp = new Uint8Array(16);
  bmp[0] = 0x42;
  bmp[1] = 0x4d;
  assert.throws(() => verifyFileContent(bmp, 'image/bmp', 'fake.bmp'), /not a valid/);
});

test('MIME resolution prefers the browser type when supported', () => {
  const fake = new File([new Uint8Array([1])], 'x.jpg', { type: 'image/webp' });
  assert.equal(resolveMimeType(fake), 'image/webp');
  const noType = new File([new Uint8Array([1])], 'x.docx', { type: '' });
  assert.equal(
    resolveMimeType(noType),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
});
