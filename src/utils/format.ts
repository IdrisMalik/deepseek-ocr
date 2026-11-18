import type { FileOcrResult } from '../services/api/types.js';

/** Compact byte size for file cards. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Remove DeepSeek OCR layout-control tokens while keeping the recognized text,
 * line breaks and paragraph structure. Page-by-page results may contain
 * `<|ref|>…<|/ref|><|box|>[[x1,y1,x2,y2]]</|box|>` spans; simple pages often
 * contain no tokens at all.
 */
export function cleanOcrText(raw: string): string {
  let text = raw;

  // Remove box spans and their bounded coordinate payload. Any closing token
  // is handled by the generic cleanup below, so malformed or repetitive output
  // cannot trigger expensive backtracking here.
  text = text.replace(/<\|box\|>\s*\[\[[^\]\n]{0,200}\]\]/g, '');
  // Drop the remaining layout tokens (<|ref|>, <|/ref|>, </|box|>, ...) while
  // keeping the recognized text between them.
  text = text.replace(/<\/?\|[/A-Za-z][A-Za-z0-9_-]{0,31}\|>/g, '');

  // Normalize line endings, trailing spaces and excessive blank lines.
  text = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

export function resultToText(result: FileOcrResult | null): string {
  if (!result) return '';
  return cleanOcrText(result.pages.map((page) => page.text).join('\n\n'));
}

export function hasTruncatedPages(results: FileOcrResult[]): boolean {
  return results.some((result) => result.pages.some((page) => page.finishReason === 'length'));
}

function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return matches ? matches.length : 0;
}

export function describeStats(text: string): string {
  const chars = Array.from(text).length;
  const lines = text.length === 0 ? 0 : text.split('\n').length;
  const words = countWords(text);
  return `${countLabel(chars, 'character')} · ${countLabel(words, 'word')} · ${countLabel(lines, 'line')}`;
}

/** Localized count with a singular/plural noun, e.g. "1 word" vs "2 words". */
function countLabel(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}

export function toPlainTextExport(text: string): string {
  return `${text.trimEnd()}\n`;
}

export function toMarkdownExport(title: string, text: string): string {
  return `# ${title}\n\n${text.trimEnd()}\n`;
}

export function safeFileStem(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '');
  const cleaned = stem.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'ocr-output';
}

export function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
