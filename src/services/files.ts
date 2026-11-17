import type { FileItem } from './api/types.js';
import { verifyFileContent } from '../utils/validate.js';
import { extensionForMime, formatForExtension, isSupportedMime, kindForMime } from './formats.js';
import { clientConfig } from '../utils/config.js';

export const MAX_FILES = clientConfig.maxFiles;
export const MAX_FILE_BYTES = clientConfig.maxFileBytes;

/** Resolve MIME using the browser value first, then the file extension. */
export function resolveMimeType(file: File): string {
  if (file.type && isSupportedMime(file.type)) return file.type.toLowerCase();
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return formatForExtension(extension)?.mime ?? file.type ?? '';
}

export function validateFile(file: File): string | null {
  const mime = resolveMimeType(file);
  if (!isSupportedMime(mime)) {
    return `“${file.name}” is not a supported format. Choose an image, PDF, Word, or PowerPoint file.`;
  }
  if (file.size === 0) {
    return `“${file.name}” is empty. Choose another file.`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `“${file.name}” is larger than the 100 MB limit. Choose a smaller file.`;
  }
  return null;
}

/** True for inputs forwarded unchanged (no browser raster preview or rotation). */
export function isDocument(item: FileItem): boolean {
  return kindForMime(item.mimeType) === 'document';
}

/** True when the browser can render this input as a thumbnail. */
export function canPreview(mimeType: string): boolean {
  return kindForMime(mimeType) === 'image';
}

/** Read the leading bytes and verify content matches the declared MIME type. */
export async function validateFileContent(file: File, mimeType: string): Promise<void> {
  const bytes = new Uint8Array(await file.slice(0, 128).arrayBuffer());
  verifyFileContent(bytes, mimeType, file.name, file.size);
}

const decoded = new Map<string, HTMLImageElement>();
const prepared = new Map<string, { rotation: number; upload: PreparedUpload }>();

/** Decode an image input only when canvas rotation is required. */
export function loadDecodedImage(item: FileItem): Promise<HTMLImageElement> {
  const cached = decoded.get(item.id);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(item.blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      decoded.set(item.id, image);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read “${item.name}”. The file may be damaged.`));
    };
    image.src = url;
  });
}

export function forgetImage(id: string): void {
  decoded.delete(id);
  prepared.delete(id);
}

export type PreparedUpload = {
  blob: Blob;
  mimeType: string;
  filename: string;
};

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('This browser could not prepare the rotated image.'));
    }, 'image/png');
  });
}

/**
 * Prepare a file for the OCR API without copying document bytes through base64
 * or re-encoding images that need no transform. Documents and unrotated images
 * keep their original Blob; only a rotated image is redrawn on a canvas.
 *
 * Prepared payloads are cached per item and rotation so scheduler retries do
 * not repeat the work.
 */
export async function prepareUpload(item: FileItem): Promise<PreparedUpload> {
  const cached = prepared.get(item.id);
  if (cached && cached.rotation === item.rotation) return cached.upload;

  let upload: PreparedUpload;
  if (isDocument(item) || item.rotation % 360 === 0) {
    upload = { blob: item.blob, mimeType: item.mimeType, filename: item.name };
  } else {
    const image = await loadDecodedImage(item);
    const rotated = item.rotation % 180 !== 0;
    const width = rotated ? image.naturalHeight : image.naturalWidth;
    const height = rotated ? image.naturalWidth : image.naturalHeight;
    if (!width || !height)
      throw new Error(`Could not read “${item.name}”. The file may be damaged.`);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot process images. Try another browser.');

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.translate(width / 2, height / 2);
    context.rotate((item.rotation * Math.PI) / 180);
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);

    const stem = item.name.replace(/\.[^.]+$/, '') || 'ocr-output';
    upload = {
      blob: await canvasToBlob(canvas),
      mimeType: 'image/png',
      filename: `${stem}.${extensionForMime('image/png')}`,
    };
  }

  prepared.set(item.id, { rotation: item.rotation, upload });
  return upload;
}

/** Extension used when exporting the recognized text for a given input file. */
export function exportExtension(item: FileItem): string {
  return extensionForMime(item.mimeType);
}

export function createItemId(): string {
  return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
