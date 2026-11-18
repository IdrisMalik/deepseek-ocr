/**
 * Single source of truth for supported input formats, matching the official
 * DeepSeek OCR service (https://api-docs.deepseek.com/guides/ocr).
 *
 * The API detects formats from file content and accepts them directly, so
 * documents are forwarded unchanged. Images are also forwarded unchanged
 * unless rotated, in which case they are re-encoded as PNG. The extraction
 * mode (`purpose`) is independent of the input format.
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
  // Browsers cannot rasterize TIFF through <img>/canvas; forward it unchanged
  // like other documents.
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

/** The accept attribute value for file inputs. */
export function acceptAttribute(): string {
  return SUPPORTED_FORMATS.flatMap((f) => [f.ext, ...(f.aliases ?? [])])
    .map((ext) => `.${ext}`)
    .join(',');
}
