/**
 * Unit coverage for the canvas rotation path in services/files.ts.
 *
 * The module only needs `Image`, `URL.createObjectURL` and a canvas factory
 * for this path, so minimal stubs let it run under the Node test runner
 * without a browser or an extra test dependency.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createItemId,
  forgetImage,
  prepareUpload,
  validateFileContent,
} from '../src/services/files.js';
import type { FileItem } from '../src/services/api/types.js';

type ContextCalls = { translate?: number[]; rotate?: number[]; drawImage?: number[] };
type CanvasSize = { width: number; height: number };

let nextImageSize = { width: 64, height: 32 };
/** When positive, newly decoded images fail (simulates a damaged file). */
let imageFailures = 0;
let toBlobResult: Blob | null = new Blob(['rotated-as-png'], { type: 'image/png' });
let imageCount = 0;
let canvasCount = 0;
let lastContext: ContextCalls = {};
let lastCanvasSize: CanvasSize = { width: 0, height: 0 };
let lastToBlobType = '';

class StubImage {
  naturalWidth: number;
  naturalHeight: number;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private source = '';

  constructor() {
    imageCount += 1;
    this.naturalWidth = nextImageSize.width;
    this.naturalHeight = nextImageSize.height;
  }

  set src(url: string) {
    this.source = url;
    queueMicrotask(() => {
      if (imageFailures > 0) this.onerror?.();
      else this.onload?.();
    });
  }

  get src(): string {
    return this.source;
  }
}

function makeCanvas(): {
  width: number;
  height: number;
  getContext: () => {
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: string;
    translate: (...args: number[]) => void;
    rotate: (...args: number[]) => void;
    drawImage: (...args: unknown[]) => void;
  };
  toBlob: (callback: (blob: Blob | null) => void, type?: string) => void;
} {
  canvasCount += 1;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      translate: (...args: number[]) => {
        lastContext.translate = args;
      },
      rotate: (...args: number[]) => {
        lastContext.rotate = args;
      },
      // The first argument is the decoded image; record the drawing offsets.
      drawImage: (...args: unknown[]) => {
        lastContext.drawImage = args.slice(1).map((value) => Number(value));
      },
    }),
    toBlob: (callback: (blob: Blob | null) => void, type?: string) => {
      lastCanvasSize = { width: canvas.width, height: canvas.height };
      lastToBlobType = type ?? '';
      queueMicrotask(() => callback(toBlobResult));
    },
  };
  return canvas;
}

const globals = globalThis as unknown as Record<string, unknown>;
globals.Image = StubImage;
globals.document = { createElement: () => makeCanvas() };
Object.assign(URL, {
  createObjectURL: (): string => 'blob:stub',
  revokeObjectURL: (): void => {},
});

function resetStubs(): void {
  nextImageSize = { width: 64, height: 32 };
  imageFailures = 0;
  toBlobResult = new Blob(['rotated-as-png'], { type: 'image/png' });
  imageCount = 0;
  canvasCount = 0;
  lastContext = {};
  lastCanvasSize = { width: 0, height: 0 };
  lastToBlobType = '';
}

function imageItem(overrides: Partial<FileItem> = {}): FileItem {
  const name = overrides.name ?? 'scan.png';
  const mimeType = overrides.mimeType ?? 'image/png';
  return {
    id: overrides.id ?? `item-${Math.floor(Math.random() * 1e9)}`,
    name,
    size: 1024,
    mimeType,
    blob: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], {
      type: mimeType,
    }),
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

test('a rotated image is re-encoded as PNG with swapped dimensions', async () => {
  resetStubs();
  const item = imageItem({ id: 'rot-90', rotation: 90, name: 'photo.jpeg' });
  const upload = await prepareUpload(item);

  assert.equal(upload.blob.type, 'image/png');
  assert.equal(upload.filename, 'photo.png');
  assert.equal(await upload.blob.text(), 'rotated-as-png');
  assert.equal(lastToBlobType, 'image/png');
  assert.deepEqual(lastCanvasSize, { width: 32, height: 64 });
  assert.deepEqual(lastContext.translate, [16, 32]);
  assert.deepEqual(lastContext.rotate, [(90 * Math.PI) / 180]);
  assert.deepEqual(lastContext.drawImage, [-32, -16]);
});

test('a half-turn rotation keeps dimensions and rotates in place', async () => {
  resetStubs();
  const item = imageItem({ id: 'rot-180', rotation: 180, name: 'photo.jpeg' });
  await prepareUpload(item);

  assert.deepEqual(lastCanvasSize, { width: 64, height: 32 });
  assert.deepEqual(lastContext.rotate, [Math.PI]);
});

test('a full-turn image is uploaded as its original blob', async () => {
  resetStubs();
  const item = imageItem({ id: 'rot-360', rotation: 360, name: 'scan.png' });
  const upload = await prepareUpload(item);

  assert.equal(upload.blob, item.blob);
  assert.equal(upload.blob.type, 'image/png');
  assert.equal(upload.filename, 'scan.png');
  assert.equal(canvasCount, 0, 'no canvas is created when nothing is rotated');
});

test('prepared uploads are cached per file and rotation', async () => {
  resetStubs();
  const item = imageItem({ id: 'cached', rotation: 90, name: 'scan.png' });

  const first = await prepareUpload(item);
  const second = await prepareUpload(item);
  assert.equal(second, first, 'identical item and rotation reuse the cached upload');
  assert.equal(imageCount, 1, 'the decoded image is decoded once');
  assert.equal(canvasCount, 1);

  item.rotation = 180;
  const third = await prepareUpload(item);
  assert.notEqual(third, first);
  assert.equal(canvasCount, 2, 'a new rotation re-prepares the upload');

  forgetImage(item.id);
  const fourth = await prepareUpload(item);
  assert.notEqual(fourth, third);
  assert.equal(canvasCount, 3, 'forgetImage clears the cached upload');
});

test('a canvas that cannot encode rejects with actionable advice', async () => {
  resetStubs();
  toBlobResult = null;
  const item = imageItem({ id: 'bad-canvas', rotation: 90, name: 'scan.png' });
  await assert.rejects(() => prepareUpload(item), /Could not rotate this image/);
});

test('an undecodable image reports the file as damaged', async () => {
  resetStubs();
  imageFailures = 1;
  const item = imageItem({ id: 'bad-image', rotation: 90, name: 'scan.png' });
  await assert.rejects(() => prepareUpload(item), /may be damaged/);
});

test('a decoded image without pixels rejects as damaged', async () => {
  resetStubs();
  nextImageSize = { width: 0, height: 0 };
  const item = imageItem({ id: 'empty-image', rotation: 90, name: 'scan.png' });
  await assert.rejects(() => prepareUpload(item), /may be damaged/);
});

test('content validation reads leading bytes against the declared MIME type', async () => {
  resetStubs();
  const png = new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    'ok.png',
    { type: 'image/png' }
  );
  await validateFileContent(png, 'image/png');

  const fake = new File([new TextEncoder().encode('<html>')], 'fake.png', {
    type: 'image/png',
  });
  await assert.rejects(() => validateFileContent(fake, 'image/png'), /not a valid PNG file/);
});

test('item ids distinguish same-tick files through the random suffix', () => {
  resetStubs();
  const originalRandom = Math.random;
  const originalNow = Date.now;
  try {
    // Frozen clock: distinct ids must come from the random suffix alone. The
    // draws are chosen so their base-36 expansions yield distinct suffixes
    // ("4fzzzx" and "zk0000" in Node, verified for the supported runtimes).
    Date.now = () => 1_700_000_000_000;
    const draws = [0.123456789, 0.987654321];
    Math.random = (): number => draws.shift() ?? 0;
    const first = createItemId();
    const second = createItemId();
    assert.notEqual(first, second);
    assert.match(first, /^img-[a-z0-9]+-[a-z0-9]{6}$/);
    assert.match(second, /^img-[a-z0-9]+-[a-z0-9]{6}$/);
  } finally {
    Math.random = originalRandom;
    Date.now = originalNow;
  }
});

test('item ids distinguish a burst even when every random draw is identical', () => {
  resetStubs();
  const originalRandom = Math.random;
  const originalNow = Date.now;
  try {
    // Worst case for collisions: no entropy from randomness at all, so
    // distinctness must come from the time component. Deterministic, unlike
    // asserting absolute uniqueness from uncontrolled random samples.
    let tick = 0;
    Date.now = (): number => 1_700_000_000_000 + (tick += 1);
    Math.random = (): number => 0.123456789;
    const ids = new Set<string>();
    for (let i = 0; i < 1_000; i += 1) ids.add(createItemId());
    assert.equal(ids.size, 1_000);
  } finally {
    Math.random = originalRandom;
    Date.now = originalNow;
  }
});
