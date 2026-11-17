/**
 * Single source of truth for input formats.
 *
 * Verified 2026-11-17 against the live official DeepSeek OCR guide and API
 * reference (https://api-docs.deepseek.com/guides/ocr, /api/ocr):
 *   "Supported: PDF, Word (DOC, DOCX), PowerPoint (PPT, PPTX), and images
 *    such as PNG, JPEG, WebP, GIF, BMP and TIFF. The format is detected from
 *    the actual file content."
 *
 * The API accepts these formats directly — no client-side conversion is
 * required or performed for documents. Images may be preprocessed on a canvas
 * (rotate) before being sent as PNG; originals are otherwise forwarded as-is.
 * The "purpose" option (text_recognition / rich_layout_recognition) governs
 * how documents are recognized and is unaffected by these formats.
 */

export type FileKind = 'image' | 'document';

export type SupportedFormat = {
  ext: string;
  aliases?: string[];
  mime: string;
  kind: FileKind;
  label: string;
};

export const SUPPORTED_FORMATS: readonly SupportedFormat[] = [
  { ext: 'png', mime: 'image/png', kind: 'image', label: 'PNG' },
  { ext: 'jpg', aliases: ['jpeg'], mime: 'image/jpeg', kind: 'image', label: 'JPEG' },
  { ext: 'webp', mime: 'image/webp', kind: 'image', label: 'WebP' },
  { ext: 'gif', mime: 'image/gif', kind: 'image', label: 'GIF' },
  { ext: 'bmp', mime: 'image/bmp', kind: 'image', label: 'BMP' },
  // Browsers cannot rasterize TIFF through <img>/canvas. Forward it unchanged
  // like other documents; the API detects the format from the file content.
  { ext: 'tif', aliases: ['tiff'], mime: 'image/tiff', kind: 'document', label: 'TIFF' },
  { ext: 'pdf', mime: 'application/pdf', kind: 'document', label: 'PDF' },
  { ext: 'doc', mime: 'application/msword', kind: 'document', label: 'DOC' },
  {
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'document',
    label: 'DOCX',
  },
  { ext: 'ppt', mime: 'application/vnd.ms-powerpoint', kind: 'document', label: 'PPT' },
  {
    ext: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'document',
    label: 'PPTX',
  },
] as const;

const mimeSet = new Set(SUPPORTED_FORMATS.map((f) => f.mime));
const extMap = new Map<string, SupportedFormat>();
for (const format of SUPPORTED_FORMATS) {
  extMap.set(format.ext, format);
  for (const alias of format.aliases ?? []) extMap.set(alias, format);
}

export function isSupportedMime(mime: string): boolean {
  return mimeSet.has(mime.toLowerCase());
}

export function formatForMime(mime: string): SupportedFormat | undefined {
  return SUPPORTED_FORMATS.find((f) => f.mime === mime.toLowerCase());
}

export function formatForExtension(extension: string): SupportedFormat | undefined {
  return extMap.get(extension.toLowerCase().replace(/^\./, ''));
}

export function kindForMime(mime: string): FileKind | undefined {
  return formatForMime(mime)?.kind;
}

export function extensionForMime(mime: string): string {
  return formatForMime(mime)?.ext ?? 'bin';
}

/** Value for the <input type="file" accept="…"> attribute. */
export function acceptAttribute(): string {
  return SUPPORTED_FORMATS.flatMap((f) => [f.ext, ...(f.aliases ?? [])])
    .map((ext) => `.${ext}`)
    .join(',');
}
