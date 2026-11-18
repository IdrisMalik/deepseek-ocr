import test from 'node:test';
import assert from 'node:assert/strict';
import { canPreview, forgetImage, prepareUpload } from '../src/services/files.js';
import type { FileItem } from '../src/services/api/types.js';

function item(overrides: Partial<FileItem> = {}): FileItem {
  const name = overrides.name ?? 'sample.pdf';
  const mimeType = overrides.mimeType ?? 'application/pdf';
  const blob = overrides.blob ?? new File([new Uint8Array([1, 2, 3])], name, { type: mimeType });
  return {
    id: 'file-1',
    name,
    size: blob.size,
    mimeType,
    blob,
    previewUrl: '',
    rotation: 0,
    status: 'ready',
    error: null,
    result: null,
    editedText: null,
    ...overrides,
  };
}

test('only browser-renderable images request a preview URL', () => {
  assert.equal(canPreview('image/png'), true);
  assert.equal(canPreview('image/jpeg'), true);
  assert.equal(canPreview('image/tiff'), false);
  assert.equal(canPreview('application/pdf'), false);
});

test('documents are uploaded as their original Blob', async () => {
  const input = item({ id: 'document-file' });
  const prepared = await prepareUpload(input);
  assert.equal(prepared.blob, input.blob);
  assert.equal(prepared.filename, 'sample.pdf');
  assert.equal(prepared.mimeType, 'application/pdf');
});

test('unrotated images are uploaded without canvas re-encoding', async () => {
  const input = item({ id: 'image-file', name: 'scan.png', mimeType: 'image/png' });
  const prepared = await prepareUpload(input);
  assert.equal(prepared.blob, input.blob);
  assert.equal(prepared.filename, 'scan.png');
  assert.equal(prepared.mimeType, 'image/png');
});

test('prepared uploads are cached per file and cleared on removal', async () => {
  const input = item({ id: 'cached-file', name: 'scan.png', mimeType: 'image/png' });
  const first = await prepareUpload(input);
  const second = await prepareUpload(input);
  assert.equal(second, first);

  forgetImage(input.id);
  const third = await prepareUpload(input);
  assert.notEqual(third, first);
  assert.equal(third.blob, first.blob);
});
