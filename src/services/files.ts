import type { FileItem } from './api/types.js';
import { verifyFileContent } from '../utils/validate.js';
import {
  extensionForMime,
  formatForExtension,
  isSupportedMime,
  kindForMime,
} from './formats.js';
import { clientConfig } from '../utils/config.js';

export const MAX_FILES = clientConfig.maxFiles;
export const MAX_FILE_BYTES = clientConfig.maxFileBytes;
const MAX_EXPORT_SIDE = 4096;

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

/** Read the leading bytes and verify content matches the declared MIME type. */
export async function validateFileContent(file: File, mimeType: string): Promise<void> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  verifyFileContent(bytes, mimeType, file.name);
}

/** Read the original file bytes as a base64 data URL (documents sent unchanged). */
export function readOriginalDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read this file. Choose another file.'));
    reader.readAsDataURL(blob);
  });
}

const decoded = new Map<string, HTMLImageElement>();

/** Decode an image input for preview and optional canvas rotation. */
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
}

export type RenderedInput = {
  dataUrl: string;
  /** MIME of the bytes in dataUrl (images are re-encoded as PNG on canvas). */
  mimeType: string;
  width: number;
  height: number;
  clamped: boolean;
};

/**
 * Prepare a file for the OCR API. Documents (PDF/Word/PowerPoint) are forwarded
 * unchanged — the API detects format from file content and parses them itself.
 * Images are optionally rotated on a canvas and exported as PNG, with dimensions
 * clamped to stay inside the documented API limits.
 */
export async function renderProcessed(item: FileItem): Promise<RenderedInput> {
  if (isDocument(item)) {
    return {
      dataUrl: await readOriginalDataUrl(item.blob),
      mimeType: item.mimeType,
      width: 0,
      height: 0,
      clamped: false,
    };
  }

  const image = await loadDecodedImage(item);
  const crop = item.crop ?? { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };
  const rotated = item.rotation % 180 !== 0;
  const baseWidth = rotated ? crop.h : crop.w;
  const baseHeight = rotated ? crop.w : crop.h;
  const clamp = Math.min(1, MAX_EXPORT_SIDE / Math.max(baseWidth, baseHeight));
  const scale = item.scale * clamp;
  const width = Math.max(1, Math.round(baseWidth * scale));
  const height = Math.max(1, Math.round(baseHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot process images. Try another browser.');

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.translate(width / 2, height / 2);
  context.scale(scale, scale);
  context.rotate((item.rotation * Math.PI) / 180);
  context.drawImage(
    image,
    crop.x, crop.y, crop.w, crop.h,
    -crop.w / 2, -crop.h / 2, crop.w, crop.h
  );

  return {
    dataUrl: canvas.toDataURL('image/png'),
    mimeType: 'image/png',
    width,
    height,
    clamped: clamp < 1,
  };
}

/** Extension used when exporting the recognized text for a given input file. */
export function exportExtension(item: FileItem): string {
  return extensionForMime(item.mimeType);
}

export function createItemId(): string {
  return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
