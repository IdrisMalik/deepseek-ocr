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

/** Semantic role labels observed in live rich-layout output. */
const REF_ROLES = 'text|title|sub_title|table|code|image|chart|chart_caption';
const REF_BOX_RE = new RegExp(
  `<[|｜]ref[|｜]>\\s*(?:${REF_ROLES})\\s*<[|｜]/ref[|｜]>\\s*` +
    `<[|｜]box[|｜]>\\s*\\[\\[[^\\]\\n]{0,200}\\]\\]\\s*<[|｜]/box[|｜]>[ \\t]*`,
  'g'
);
const REF_ROLE_RE = new RegExp(
  `<[|｜]ref[|｜]>\\s*(?:${REF_ROLES})\\s*<[|｜]/ref[|｜]>[ \\t]*`,
  'g'
);
const BOX_RE = /<[|｜]box[|｜]>\s*\[\[[^\]\n]{0,200}\]\]/g;
const TOKEN_RE = /<\/?[|｜][/A-Za-z][A-Za-z0-9_-]{0,31}[|｜]>/g;
const HTML_TABLE_RE = /<table\b[^>]*>[\s\S]*?<\/table>/gi;
const HTML_ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const HTML_CELL_RE = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
const HTML_ENTITY_RE = /&(#x?[0-9a-f]+|[a-z]+);/gi;
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeHtmlEntities(value: string): string {
  return value.replace(HTML_ENTITY_RE, (match, code: string) => {
    const lower = code.toLowerCase();
    if (lower in NAMED_ENTITIES) return NAMED_ENTITIES[lower];
    const radix = lower.startsWith('#x') ? 16 : 10;
    const digits = lower.startsWith('#x') ? lower.slice(2) : lower.slice(1);
    const point = Number.parseInt(digits, radix);
    return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
      ? String.fromCodePoint(point)
      : match;
  });
}

function cleanHtmlCell(value: string): string {
  const text = value.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(text).replace(/\s+/g, ' ').trim();
}

/** Turn the simple HTML tables emitted by the model into readable Markdown rows. */
function htmlTableToText(table: string): string {
  const rows: string[][] = [];
  for (const row of table.matchAll(HTML_ROW_RE)) {
    const cells = Array.from(row[1].matchAll(HTML_CELL_RE), (cell) => cleanHtmlCell(cell[1]));
    if (cells.some((cell) => cell)) rows.push(cells);
  }
  if (rows.length === 0) return '';

  const columns = Math.max(...rows.map((row) => row.length));
  const lines = rows.map((row) => {
    const cells = row.concat(Array<string>(columns - row.length).fill(''));
    return `| ${cells.join(' | ')} |`;
  });
  if (lines.length > 1) {
    lines.splice(1, 0, `| ${Array<string>(columns).fill('---').join(' | ')} |`);
  }
  return lines.join('\n');
}

/**
 * Normalize model layout markup into editable text.
 *
 * Live rich-layout pages use fullwidth `｜` (U+FF5C) tokens, prefixing content
 * with a semantic role and coordinate box, e.g.
 * `<｜ref｜>title<｜/ref｜><｜box｜>[[49,138,227,200]]<｜/box｜> Heading`. The
 * documented format uses ASCII `|` and can put recognized text directly inside
 * the ref span. Only known role labels are discarded with their box; anything
 * else between the tokens is kept as recognized text.
 */
export function cleanOcrText(raw: string): string {
  let text = raw;

  // Live output: role + coordinate box, then the recognized content.
  text = text.replace(REF_BOX_RE, '');
  // Known role without a box, e.g. markup cut off by a truncated response.
  text = text.replace(REF_ROLE_RE, '');
  // Remaining coordinate payloads and layout tags.
  text = text.replace(BOX_RE, '');
  text = text.replace(TOKEN_RE, '');

  // The model sometimes emits simple HTML tables; keep their structure readable.
  text = text.replace(HTML_TABLE_RE, (table) => htmlTableToText(table));
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, '\n');
  text = text.replace(
    /<\/?(?:table|thead|tbody|tr|td|th|p|div|span|strong|b|em|i|u|code|pre|ul|ol|li|h[1-6])\b[^>]*>/gi,
    ' '
  );
  text = decodeHtmlEntities(text);

  // Word output uses private-use bullet glyphs; normalize them to Markdown.
  text = text.replace(/^[\uE000-\uF8FF\u2022][ \t]*(?:\n)?/gm, '- ');

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
