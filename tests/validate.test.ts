import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyFileContent } from '../src/utils/validate.js';
import { acceptAttribute, kindForMime, SUPPORTED_FORMATS } from '../src/services/formats.js';
import { existsSync } from 'node:fs';
import { resolveMimeType, validateFile } from '../src/services/files.js';

const fixture = (name: string): File => {
  const bytes = readFileSync(join(process.cwd(), 'tests', 'fixtures', name));
  return new File([bytes], name);
};

test('all 11 advertised formats validate from representative fixtures', () => {
  for (const format of SUPPORTED_FORMATS) {
    const candidate = [format.ext, ...(format.aliases ?? [])]
      .map((ext) => `sample.${ext}`)
      .find((name) => existsSync(join(process.cwd(), 'tests', 'fixtures', name)));
    assert.ok(candidate, `fixture for ${format.label}`);
    const name = candidate!;
    const file = fixture(name);
    const mime = resolveMimeType(file);
    assert.equal(mime, format.mime, `mime for ${name}`);
    assert.equal(validateFile(file), null, `validation for ${name}`);
    verifyFileContent(new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', name))).slice(0, 16), mime, name);
  }
});

test('TIFF is forwarded unchanged (browsers cannot rasterize it)', () => {
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

test('validation rejects unsupported, empty and oversized files', () => {
  assert.match(validateFile(fixture('not-an-image.txt')) ?? '', /not a supported format/);
  assert.match(validateFile(new File([], 'empty.png', { type: 'image/png' })) ?? '', /empty/);
  const big = new File([new Uint8Array(101 * 1024 * 1024)], 'big.png', { type: 'image/png' });
  assert.match(validateFile(big) ?? '', /100 MB/);
});

test('content verification rejects malformed and mismatched files', () => {
  const malformed = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'malformed.bin')));
  assert.throws(() => verifyFileContent(malformed, 'application/pdf', 'fake.pdf'), /not a valid/);
  const png = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'sample.png'))).slice(0, 16);
  assert.throws(() => verifyFileContent(png, 'application/pdf', 'wrong.pdf'), /not a valid/);
});

test('MIME resolution prefers the browser type when supported', () => {
  const fake = new File([new Uint8Array([1])], 'x.jpg', { type: 'image/webp' });
  assert.equal(resolveMimeType(fake), 'image/webp');
  const noType = new File([new Uint8Array([1])], 'x.docx', { type: '' });
  assert.equal(resolveMimeType(noType), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});
