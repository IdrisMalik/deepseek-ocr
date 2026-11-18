/* eslint-disable no-console -- CLI report output */
/**
 * Offline and live evaluation for the OCR evaluation suite.
 *
 * Offline (default): re-run the app's real response parser and text cleaner
 * against frozen live recordings, assert deterministic invariants, compute
 * informational accuracy metrics, and compare with the stored baseline.
 *
 * Live: requires both --live and --confirm-paid. Sends one authorized request
 * per selected fixture, purpose, and repetition. Live accuracy is reported as
 * provider evidence, not as a deterministic pass/fail score.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanOcrText } from '../../../src/utils/format.js';
import { OcrError, parseOcrResponse } from '../../../src/services/api/errors.js';
import type { OcrPurpose } from '../../../src/services/api/types.js';

const SUITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(SUITE_ROOT, '..', '..');
const RECORDINGS_DIR = join(SUITE_ROOT, 'recordings', 'live-2026-11-18');
const RUNS_DIR = join(SUITE_ROOT, 'recordings', 'runs');
const REPORT_DIR = join(SUITE_ROOT, 'reports');
const BASELINE_PATH = join(REPORT_DIR, 'offline_baseline.json');
const MANIFEST_PATH = join(SUITE_ROOT, 'manifest.csv');
const GROUND_TRUTH_PATH = join(SUITE_ROOT, 'ground_truth', 'ground_truth.json');
const OCR_URL = 'https://api.deepseek.com/v1/tools/ocr';

type Expectation = 'text' | 'layout' | 'empty' | 'observe' | 'error';

type GroundTruthFixture = {
  file: string;
  path: string;
  kind: 'image' | 'document';
  expectation: Expectation;
  pages: string[][];
  optional_lines?: string[];
  rows?: string[][];
  order?: string[];
  ids?: string[];
  expected_error?: { status?: number; type?: string; code?: string; message?: string };
  visible_text?: boolean;
  known_gaps?: string[];
  notes?: string;
};

type GroundTruthFile = {
  schema_version: string;
  snapshot_date: string;
  normalization_for_comparison: string;
  expectation_classes: Record<Expectation, string>;
  fixtures: Record<string, GroundTruthFixture>;
};

type ProviderError = {
  message?: string;
  type?: string;
  code?: string;
  param?: unknown;
};

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

type RecordedPage = {
  index: number;
  text: string;
  finish_reason: string | null;
};

type RecordedRun = {
  fixture_id: string;
  purpose: OcrPurpose;
  rep: number;
  status: number | null;
  ok: boolean;
  elapsed_s: number;
  response_bytes?: number;
  content_type?: string;
  page_count: number | null;
  pages: RecordedPage[];
  usage: Usage | null;
  error: ProviderError | null;
};

type RecordingFile = {
  schema_version: string;
  recorded_at?: string;
  source: string;
  notes: string;
  run_count: number;
  runs: RecordedRun[];
};

type ManifestRow = {
  id: string;
  path: string;
  kind: 'image' | 'document';
  formatFromBytes: string;
  dimensionsPx: string;
  frames: string;
  pages: string;
  purposes: OcrPurpose[];
  category: string;
  expectation: Expectation;
  objective: string;
  criteria: string;
  provenance: string;
};

type RunMetrics = {
  key: string;
  fixture_id: string;
  purpose: OcrPurpose;
  rep: number;
  status: number | null;
  ok: boolean;
  pages: number;
  page_lengths: number[];
  finish: string;
  truncated: boolean;
  latency_s: number;
  total_tokens: number | null;
  raw_chars: number;
  clean_chars: number;
  content_chars: number;
  layout_tokens: number;
  leaked_tokens: number;
  leaked_roles: number;
  leaked_boxes: number;
  html_tables: number;
  scorable: boolean;
  gt_tokens: number;
  out_tokens: number;
  token_recall: number | null;
  token_precision: number | null;
  sequence_ratio: number | null;
  line_token_coverage: number | null;
  line_contiguous_rate: number | null;
  order_score: number | null;
  order_items_found: number | null;
  row_fidelity: number | null;
  has_table_markup: boolean;
  has_heading_markup: boolean;
  has_bold_markup: boolean;
  has_italic_markup: boolean;
  duplicate_line_ratio: number;
  id_recall: number | null;
  id_missing: number | null;
  id_count: number | null;
  id_order_ratio: number | null;
  empty: boolean;
  app_parse: string;
  optional_line_coverage: number | null;
  content: string;
};

type Aggregate = {
  purpose: OcrPurpose;
  runs: number;
  quality_runs: number;
  ok_rate: number;
  empty_rate: number;
  length_rate: number;
  token_recall: number | null;
  token_precision: number | null;
  sequence_ratio: number | null;
  line_token_coverage: number | null;
  order_score: number | null;
  row_fidelity: number | null;
  id_recall: number | null;
  leaked_tokens: number;
  mean_latency_s: number;
  mean_total_tokens: number;
};

type BaselineFile = {
  schema_version: string;
  generated_on: string;
  recording_files: string[];
  run_count: number;
  fixtures_without_recordings: string[];
  metrics: RunMetrics[];
  aggregates: Record<string, Aggregate>;
  parser_invariants: { passed: boolean; failures: string[] };
};

type Verification = {
  failures: string[];
  checks: number;
};

const LAYOUT_TOKEN_RE = /<[|｜][^>]{0,64}[|｜]>/g;
const ROLE_TOKEN_RE = /<[|｜]\s*\/?\s*(?:ref|box)\s*[|｜]>/g;
const BOX_PAYLOAD_RE = /\[\[\s*-?\d+(?:\s*,\s*-?\d+){3}\s*\]\]/g;
const HTML_TABLE_RE = /<table\b/i;
const HTML_CELL_RE = /<t[dhr]\b/i;
const TOKEN_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{M}\p{N}]+(?:[.,]\d+)?%?/gu;
const ID_RE = /L(\d{3})/g;
const MARKUP_RE = /<[^>]+>/g;

function fail(message: string): never {
  throw new Error(message);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function loadManifest(): ManifestRow[] {
  const [header, ...rows] = parseCsv(readFileSync(MANIFEST_PATH, 'utf8'));
  if (!header) fail('manifest.csv is empty');
  const index = new Map(header.map((name, i) => [name, i]));
  const get = (row: string[], name: string): string => row[index.get(name) ?? -1] ?? '';
  return rows
    .filter((row) => row.some((cell) => cell.trim() !== ''))
    .map((row) => ({
      id: get(row, 'id'),
      path: get(row, 'path'),
      kind: get(row, 'kind') === 'document' ? 'document' : 'image',
      formatFromBytes: get(row, 'format_from_bytes'),
      dimensionsPx: get(row, 'dimensions_px'),
      frames: get(row, 'frames'),
      pages: get(row, 'pages'),
      purposes: get(row, 'api_purposes')
        .split('|')
        .filter(
          (value): value is OcrPurpose =>
            value === 'text_recognition' || value === 'rich_layout_recognition'
        ),
      category: get(row, 'category'),
      expectation: get(row, 'expectation') as Expectation,
      objective: get(row, 'test_objective'),
      criteria: get(row, 'evaluation_criteria'),
      provenance: get(row, 'provenance'),
    }));
}

function loadRecordings(): { files: string[]; runs: RecordedRun[] } {
  if (!existsSync(RECORDINGS_DIR)) fail(`missing recordings directory: ${RECORDINGS_DIR}`);
  const files = readdirSync(RECORDINGS_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const runs: RecordedRun[] = [];
  for (const name of files) {
    const recording = readJson<RecordingFile>(join(RECORDINGS_DIR, name));
    if (!Array.isArray(recording.runs)) fail(`${name}: runs is not an array`);
    if (recording.run_count !== recording.runs.length) {
      fail(`${name}: run_count ${recording.run_count} != ${recording.runs.length}`);
    }
    for (const run of recording.runs) {
      runs.push({ ...run, response_bytes: run.response_bytes, content_type: run.content_type });
    }
  }
  return { files, runs };
}

function toContent(text: string): string {
  let value = text.replace(LAYOUT_TOKEN_RE, ' ');
  value = value.replace(MARKUP_RE, ' ');
  value = value.replace(/\r\n?/g, '\n');
  const lines: string[] = [];
  for (const rawLine of value.split('\n')) {
    let line = rawLine.trim();
    line = line.replace(/^#{1,6}\s*/, '');
    line = line.replace(/^[-*•]\s*/, '');
    line = line.replace(/\|/g, ' ');
    line = line.replace(/[\uE000-\uF8FF]/g, ' ');
    line = line.replace(/[ \t]+/g, ' ').trim();
    if (line && !/^[-: ]+$/.test(line)) lines.push(line);
  }
  return lines.join('\n');
}

function tokenize(text: string): string[] {
  return Array.from(text.matchAll(TOKEN_RE), (match) => match[0].toLowerCase());
}

function counter(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function multisetRecall(expected: string[], actual: string[]): number {
  if (expected.length === 0) return 1;
  const exp = counter(expected);
  const act = counter(actual);
  let overlap = 0;
  for (const [key, count] of exp) overlap += Math.min(count, act.get(key) ?? 0);
  return overlap / expected.length;
}

function lineCoverage(line: string, actual: string[]): number {
  const expected = tokenize(line);
  return expected.length === 0 ? 1 : multisetRecall(expected, actual);
}

function contiguous(line: string, actual: string[]): boolean {
  const expected = tokenize(line);
  if (expected.length === 0) return true;
  for (let i = 0; i <= actual.length - expected.length; i += 1) {
    let matches = true;
    for (let j = 0; j < expected.length; j += 1) {
      if (actual[i + j] !== expected[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function firstIndex(phrase: string, actual: string[]): number | null {
  const expected = tokenize(phrase);
  if (expected.length === 0) return null;
  for (let i = 0; i <= actual.length - expected.length; i += 1) {
    let matches = true;
    for (let j = 0; j < expected.length; j += 1) {
      if (actual[i + j] !== expected[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return i;
  }
  return actual.indexOf(expected[0]) >= 0 ? actual.indexOf(expected[0]) : null;
}

function orderScore(order: string[], actual: string[]): { score: number; found: number } {
  const positions = order
    .map((phrase) => firstIndex(phrase, actual))
    .filter((position): position is number => position !== null);
  if (positions.length < 2)
    return { score: positions.length === order.length ? 1 : 0, found: positions.length };
  let correct = 0;
  let total = 0;
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      total += 1;
      if (positions[i] < positions[j]) correct += 1;
    }
  }
  return { score: correct / total, found: positions.length };
}

function duplicateRatio(text: string): number {
  const lines = toContent(text)
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  return lines.length === 0 ? 0 : 1 - new Set(lines).size / lines.length;
}

function rowFidelity(rows: string[][], actual: string[]): number {
  if (rows.length === 0) return 1;
  const act = counter(actual);
  let ok = 0;
  for (const row of rows) {
    const needed = counter(row.flatMap((cell) => tokenize(cell)));
    let rowOk = true;
    for (const [key, count] of needed) {
      if ((act.get(key) ?? 0) < count) {
        rowOk = false;
        break;
      }
    }
    if (rowOk) ok += 1;
  }
  return ok / rows.length;
}

function tableMarkup(raw: string): boolean {
  return /<table\b/i.test(raw) || /^\s*\|.*\|\s*$/m.test(raw);
}

function headingCount(raw: string): number {
  return (raw.match(/^\s*#{1,6}\s+/gm) ?? []).length;
}

function lcsLength(a: string[], b: string[]): number {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return 0;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  for (let d = 0; d <= max; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return (n + m - d) / 2;
    }
  }
  return 0;
}

function sequenceRatio(expected: string[], actual: string[]): number {
  const total = expected.length + actual.length;
  return total === 0 ? 1 : (2 * lcsLength(expected, actual)) / total;
}

function idMetrics(
  ids: string[],
  text: string
): {
  recall: number | null;
  missing: number | null;
  count: number | null;
  orderRatio: number | null;
} {
  if (ids.length === 0) return { recall: null, missing: null, count: null, orderRatio: null };
  const expected = new Set(ids.map((id) => id.replace(/^L/i, '')));
  const actual = Array.from(text.matchAll(ID_RE), (match) => match[1]);
  const present = new Set(actual);
  let missing = 0;
  for (const id of expected) if (!present.has(id)) missing += 1;

  const tails: number[] = [];
  for (const value of actual) {
    const number = Number(value);
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (tails[mid] < number) low = mid + 1;
      else high = mid;
    }
    if (low === tails.length) tails.push(number);
    else tails[low] = number;
  }

  let overlap = 0;
  for (const id of expected) if (present.has(id)) overlap += 1;
  return {
    recall: overlap / expected.size,
    missing,
    count: actual.length,
    orderRatio: tails.length / expected.size,
  };
}

function appParseOutcome(run: RecordedRun): string {
  try {
    if (run.error) {
      parseOcrResponse(JSON.stringify({ error: run.error }));
      return 'unexpected:accepted-error';
    }
    const payload = {
      page_count: run.page_count ?? run.pages.length,
      pages: run.pages.map((page) => ({
        index: page.index,
        text: page.text,
        finish_reason: page.finish_reason ?? 'unknown',
      })),
    };
    parseOcrResponse(JSON.stringify(payload));
    return 'ok';
  } catch (error) {
    if (error instanceof OcrError) {
      return run.error ? `error:${error.code}` : `throw:${error.code}`;
    }
    return `unexpected:${error instanceof Error ? error.message : String(error)}`;
  }
}

function expectedAppParse(run: RecordedRun, clean: string): string {
  if (run.error) return `error:${run.error.code ?? run.error.type ?? 'provider_error'}`;
  return clean.trim() ? 'ok' : 'throw:empty_result';
}

function metricsFor(run: RecordedRun, fixture: GroundTruthFixture): RunMetrics {
  const raw = run.pages.map((page) => page.text).join('\n\n');
  const clean = cleanOcrText(raw);
  const content = toContent(clean);
  const actualTokens = tokenize(content);
  const gtText = fixture.pages.map((page) => page.join('\n')).join('\n');
  const gtTokens = tokenize(gtText);
  const scorable = gtTokens.length > 0 && !run.error;
  const ids = idMetrics(fixture.ids ?? [], raw);
  const order = fixture.order ? orderScore(fixture.order, actualTokens) : null;
  const optionalCoverage = fixture.optional_lines
    ? mean(fixture.optional_lines.map((line) => lineCoverage(line, actualTokens)))
    : null;
  const finished = run.pages
    .map((page) => page.finish_reason)
    .filter((value): value is string => typeof value === 'string');
  const appParse = appParseOutcome(run);

  return {
    key: `${run.fixture_id}/${run.purpose}/${run.rep}`,
    fixture_id: run.fixture_id,
    purpose: run.purpose,
    rep: run.rep,
    status: run.status,
    ok: run.ok,
    pages: run.page_count ?? run.pages.length,
    page_lengths: run.pages.map((page) => page.text.length),
    finish: finished.join(','),
    truncated: finished.includes('length'),
    latency_s: run.elapsed_s,
    total_tokens: run.usage?.total_tokens ?? null,
    raw_chars: raw.length,
    clean_chars: clean.length,
    content_chars: content.length,
    layout_tokens: (raw.match(LAYOUT_TOKEN_RE) ?? []).length,
    leaked_tokens: (clean.match(LAYOUT_TOKEN_RE) ?? []).length,
    leaked_roles: (clean.match(ROLE_TOKEN_RE) ?? []).length,
    leaked_boxes: (clean.match(BOX_PAYLOAD_RE) ?? []).length,
    html_tables: HTML_TABLE_RE.test(clean) || HTML_CELL_RE.test(clean) ? 1 : 0,
    scorable,
    gt_tokens: gtTokens.length,
    out_tokens: actualTokens.length,
    token_recall: scorable ? multisetRecall(gtTokens, actualTokens) : null,
    token_precision: scorable ? multisetRecall(actualTokens, gtTokens) : null,
    sequence_ratio: scorable ? sequenceRatio(gtTokens, actualTokens) : null,
    line_token_coverage: scorable
      ? mean(
          gtText
            .split('\n')
            .filter(Boolean)
            .map((line) => lineCoverage(line, actualTokens))
        )
      : null,
    line_contiguous_rate: scorable
      ? mean(
          gtText
            .split('\n')
            .filter(Boolean)
            .map((line) => (contiguous(line, actualTokens) ? 1 : 0))
        )
      : null,
    order_score: order && scorable ? order.score : null,
    order_items_found: order ? order.found : null,
    row_fidelity: fixture.rows && scorable ? rowFidelity(fixture.rows, actualTokens) : null,
    has_table_markup: tableMarkup(raw),
    has_heading_markup: headingCount(raw) > 0,
    has_bold_markup: raw.includes('**'),
    has_italic_markup: /(?<!\*)\*(?!\*)/.test(raw),
    duplicate_line_ratio: duplicateRatio(raw),
    id_recall: ids.recall,
    id_missing: ids.missing,
    id_count: ids.count,
    id_order_ratio: ids.orderRatio,
    empty: run.error ? false : content.trim() === '',
    app_parse: appParse,
    optional_line_coverage: optionalCoverage,
    content: content.slice(0, 300),
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function meanOrNull(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : mean(present);
}

function aggregate(metrics: RunMetrics[], purpose: OcrPurpose): Aggregate {
  const group = metrics.filter((row) => row.purpose === purpose);
  const quality = group.filter((row) => row.ok && row.scorable && !row.empty);
  return {
    purpose,
    runs: group.length,
    quality_runs: quality.length,
    ok_rate: group.length === 0 ? 0 : group.filter((row) => row.ok).length / group.length,
    empty_rate: group.length === 0 ? 0 : group.filter((row) => row.empty).length / group.length,
    length_rate:
      group.length === 0 ? 0 : group.filter((row) => row.truncated).length / group.length,
    token_recall: meanOrNull(quality.map((row) => row.token_recall)),
    token_precision: meanOrNull(quality.map((row) => row.token_precision)),
    sequence_ratio: meanOrNull(quality.map((row) => row.sequence_ratio)),
    line_token_coverage: meanOrNull(quality.map((row) => row.line_token_coverage)),
    order_score: meanOrNull(quality.map((row) => row.order_score)),
    row_fidelity: meanOrNull(quality.map((row) => row.row_fidelity)),
    id_recall: meanOrNull(quality.map((row) => row.id_recall)),
    leaked_tokens: group.reduce((sum, row) => sum + row.leaked_tokens, 0),
    mean_latency_s: mean(group.map((row) => row.latency_s)),
    mean_total_tokens: mean(
      group.map((row) => row.total_tokens).filter((value): value is number => value !== null)
    ),
  };
}

function verifyRun(
  run: RecordedRun,
  fixture: GroundTruthFixture,
  metrics: RunMetrics,
  strictRecording: boolean
): Verification {
  const failures: string[] = [];
  let checks = 0;
  const label = `${run.fixture_id}/${run.purpose}/rep${run.rep}`;

  checks += 1;
  if (!fixture) failures.push(`${label}: fixture is missing from ground truth`);

  if (!run.error) {
    checks += 1;
    if (run.page_count !== null && run.page_count !== run.pages.length) {
      failures.push(`${label}: page_count ${run.page_count} != ${run.pages.length} pages`);
    }
    checks += 1;
    for (let i = 0; i < run.pages.length; i += 1) {
      if (run.pages[i].index !== i) {
        failures.push(`${label}: page index ${run.pages[i].index} at position ${i}`);
      }
    }
  }

  checks += 1;
  if (metrics.leaked_tokens + metrics.leaked_roles + metrics.leaked_boxes > 0) {
    failures.push(
      `${label}: cleaned text leaks ${metrics.leaked_tokens} layout tokens, ` +
        `${metrics.leaked_roles} roles, ${metrics.leaked_boxes} boxes`
    );
  }
  checks += 1;
  if (metrics.html_tables > 0)
    failures.push(`${label}: cleaned text still contains HTML table markup`);

  checks += 1;
  const expectedParse = expectedAppParse(
    run,
    cleanOcrText(run.pages.map((page) => page.text).join('\n\n'))
  );
  const emptyHandled =
    metrics.app_parse === 'throw:empty_result' || metrics.app_parse === 'throw:empty_response';
  if (
    metrics.app_parse !== expectedParse &&
    !(expectedParse === 'throw:empty_result' && emptyHandled)
  ) {
    failures.push(`${label}: app parse outcome ${metrics.app_parse}, expected ${expectedParse}`);
  }

  if (
    fixture.expectation === 'empty' &&
    strictRecording &&
    run.purpose === 'rich_layout_recognition'
  ) {
    checks += 1;
    if (!metrics.empty) failures.push(`${label}: expected clean empty output for a blank fixture`);
  }

  if (fixture.expectation === 'error') {
    checks += 1;
    if (run.ok) failures.push(`${label}: expected a provider error, got ok=true`);
    checks += 1;
    if (!run.error) failures.push(`${label}: expected an error payload`);
    checks += 1;
    if (!metrics.app_parse.startsWith('error:')) {
      failures.push(`${label}: app did not surface the provider error (${metrics.app_parse})`);
    }
    if (strictRecording && fixture.expected_error?.code) {
      checks += 1;
      if (run.error?.code !== fixture.expected_error.code) {
        failures.push(
          `${label}: recorded error code ${run.error?.code ?? 'none'} != ${fixture.expected_error.code}`
        );
      }
    }
  }

  return { failures, checks };
}

function evaluateRecordings(
  manifest: ManifestRow[],
  fixtures: Record<string, GroundTruthFixture>,
  runs: RecordedRun[],
  strictRecording: boolean
): { metrics: RunMetrics[]; verification: Verification } {
  const purposes = new Map(manifest.map((row) => [row.id, new Set(row.purposes)]));
  const failures: string[] = [];
  let checks = 0;
  const metrics: RunMetrics[] = [];

  for (const run of runs) {
    const fixture = fixtures[run.fixture_id];
    checks += 1;
    if (!fixture) {
      failures.push(`${run.fixture_id}: recording has no ground-truth fixture`);
      continue;
    }
    checks += 1;
    if (!purposes.get(run.fixture_id)?.has(run.purpose)) {
      failures.push(`${run.fixture_id}: recording purpose ${run.purpose} is not in the manifest`);
    }
    const row = metricsFor(run, fixture);
    metrics.push(row);
    const result = verifyRun(run, fixture, row, strictRecording);
    checks += result.checks;
    failures.push(...result.failures);
  }

  return { metrics, verification: { failures, checks } };
}

function compareBaseline(baseline: BaselineFile, metrics: RunMetrics[]): string[] {
  const failures: string[] = [];
  const current = new Map(metrics.map((row) => [row.key, row]));
  const previous = new Map(baseline.metrics.map((row) => [row.key, row]));

  for (const key of previous.keys()) {
    if (!current.has(key))
      failures.push(`${key}: baseline run is missing from the current recordings`);
  }
  for (const key of current.keys()) {
    if (!previous.has(key)) failures.push(`${key}: current run is missing from the baseline`);
  }

  const fields: Array<keyof RunMetrics> = [
    'status',
    'ok',
    'pages',
    'page_lengths',
    'finish',
    'truncated',
    'raw_chars',
    'clean_chars',
    'content_chars',
    'layout_tokens',
    'leaked_tokens',
    'leaked_roles',
    'leaked_boxes',
    'html_tables',
    'gt_tokens',
    'out_tokens',
    'token_recall',
    'token_precision',
    'sequence_ratio',
    'line_token_coverage',
    'line_contiguous_rate',
    'order_score',
    'row_fidelity',
    'id_recall',
    'id_missing',
    'id_count',
    'id_order_ratio',
    'duplicate_line_ratio',
    'has_table_markup',
    'has_heading_markup',
    'has_bold_markup',
    'has_italic_markup',
    'empty',
    'app_parse',
    'optional_line_coverage',
  ];

  for (const [key, row] of current) {
    const old = previous.get(key);
    if (!old) continue;
    for (const field of fields) {
      const before = old[field];
      const after = row[field];
      if (typeof before === 'number' && typeof after === 'number') {
        if (Math.abs(before - after) > 1e-9) {
          failures.push(`${key}: ${field} changed ${before} -> ${after}`);
        }
      } else if (JSON.stringify(before) !== JSON.stringify(after)) {
        failures.push(
          `${key}: ${field} changed ${JSON.stringify(before)} -> ${JSON.stringify(after)}`
        );
      }
    }
  }
  return failures;
}

function formatNumber(value: number | null, digits = 3): string {
  return value === null ? '-' : value.toFixed(digits);
}

function printMetrics(metrics: RunMetrics[]): void {
  console.log('\n=== PER FIXTURE AND MODE ===');
  console.log(
    'fixture mode runs ok empty len recall  prec  seq   line  order rows  idR   idO  leak'
  );
  const groups = new Map<string, RunMetrics[]>();
  for (const row of metrics) {
    const key = `${row.fixture_id}|${row.purpose}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const sorted = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [key, group] of sorted) {
    const [fixture, purpose] = key.split('|');
    const mode = purpose === 'text_recognition' ? 'std' : 'rich';
    const runs = group.length;
    const quality = group.filter((row) => row.ok && row.scorable && !row.empty);
    const agg = aggregate(group, purpose as OcrPurpose);
    const order = meanOrNull(quality.map((row) => row.order_score));
    const rows = meanOrNull(quality.map((row) => row.row_fidelity));
    const idr = meanOrNull(quality.map((row) => row.id_recall));
    const ido = meanOrNull(quality.map((row) => row.id_order_ratio));
    const leaks = group.reduce((sum, row) => sum + row.leaked_tokens, 0);
    const len = group.filter((row) => row.truncated).length;
    console.log(
      `${fixture} ${mode.padEnd(4)} ${String(runs).padStart(4)} ` +
        `${String(group.filter((row) => row.ok).length).padStart(2)} ` +
        `${String(group.filter((row) => row.empty).length).padStart(5)} ` +
        `${String(len).padStart(3)} ${formatNumber(agg.token_recall)}  ` +
        `${formatNumber(agg.token_precision)} ${formatNumber(agg.sequence_ratio)} ` +
        `${formatNumber(agg.line_token_coverage)} ${formatNumber(order)} ` +
        `${formatNumber(rows)} ${formatNumber(idr)} ${formatNumber(ido)} ` +
        `${String(leaks).padStart(4)}`
    );
  }

  console.log('\n=== MODE AGGREGATES ===');
  for (const purpose of ['text_recognition', 'rich_layout_recognition'] as const) {
    const agg = aggregate(metrics, purpose);
    if (agg.runs === 0) continue;
    console.log(
      `${purpose === 'text_recognition' ? 'std ' : 'rich'} n=${agg.runs} q=${agg.quality_runs} ` +
        `ok=${agg.ok_rate.toFixed(2)} empty=${agg.empty_rate.toFixed(2)} ` +
        `len=${agg.length_rate.toFixed(2)} recall=${formatNumber(agg.token_recall)} ` +
        `prec=${formatNumber(agg.token_precision)} seq=${formatNumber(agg.sequence_ratio)} ` +
        `line=${formatNumber(agg.line_token_coverage)} order=${formatNumber(agg.order_score)} ` +
        `rows=${formatNumber(agg.row_fidelity)} idR=${formatNumber(agg.id_recall)} ` +
        `leak=${agg.leaked_tokens} lat=${agg.mean_latency_s.toFixed(2)}s ` +
        `tok=${agg.mean_total_tokens.toFixed(0)}`
    );
  }
}

function printEvidence(metrics: RunMetrics[], fixtures: Record<string, GroundTruthFixture>): void {
  console.log('\n=== EVIDENCE WATCHPOINTS ===');
  for (const [fid, fixture] of Object.entries(fixtures)) {
    if (fixture.known_gaps?.length) {
      const count = metrics.filter((row) => row.fixture_id === fid).length;
      console.log(`${fid} (${count} runs): ${fixture.known_gaps.join(' ')}`);
    }
  }
  const missing = Object.keys(fixtures).filter(
    (fid) => !metrics.some((row) => row.fixture_id === fid)
  );
  if (missing.length > 0) console.log(`Fixtures without recordings: ${missing.join(', ')}`);
}

function writeBaseline(
  files: string[],
  metrics: RunMetrics[],
  fixtures: Record<string, GroundTruthFixture>,
  verification: Verification
): BaselineFile {
  const baseline: BaselineFile = {
    schema_version: '1.0',
    generated_on: '2026-11-18',
    recording_files: files,
    run_count: metrics.length,
    fixtures_without_recordings: Object.keys(fixtures).filter(
      (fid) => !metrics.some((row) => row.fixture_id === fid)
    ),
    metrics,
    aggregates: {
      text_recognition: aggregate(metrics, 'text_recognition'),
      rich_layout_recognition: aggregate(metrics, 'rich_layout_recognition'),
    },
    parser_invariants: {
      passed: verification.failures.length === 0,
      failures: verification.failures,
    },
  };
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  return baseline;
}

function mimeFor(id: string, path: string): string {
  if (id === 'T15') return 'image/jpeg';
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.bmp':
      return 'image/bmp';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    default:
      return 'application/octet-stream';
  }
}

async function postOnce(
  row: ManifestRow,
  purpose: OcrPurpose,
  key: string,
  timeoutMs: number
): Promise<RecordedRun> {
  const path = join(SUITE_ROOT, row.path);
  if (!existsSync(path)) fail(`missing fixture: ${row.path}`);
  const bytes = readFileSync(path);
  const filename = row.id === 'T15' ? 'fixture.jpg' : basename(row.path);
  const form = new FormData();
  form.append('purpose', purpose);
  form.append('file', new Blob([bytes], { type: mimeFor(row.id, row.path) }), filename);
  const started = Date.now();
  let response: Response;
  let body: string;
  try {
    response = await fetch(OCR_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
    body = await response.text();
  } catch (error) {
    return {
      fixture_id: row.id,
      purpose,
      rep: 1,
      status: null,
      ok: false,
      elapsed_s: (Date.now() - started) / 1000,
      page_count: null,
      pages: [],
      usage: null,
      error: { message: error instanceof Error ? error.message : String(error), type: 'network' },
    };
  }

  const elapsed = (Date.now() - started) / 1000;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    payload = { error: { message: body.slice(0, 500), type: 'non_json' } };
  }
  const rawPages = Array.isArray(payload.pages) ? payload.pages : [];
  const pages: RecordedPage[] = rawPages.map((value, index) => {
    const page = (value ?? {}) as Record<string, unknown>;
    return {
      index: typeof page.index === 'number' ? page.index : index,
      text: typeof page.text === 'string' ? page.text : '',
      finish_reason: typeof page.finish_reason === 'string' ? page.finish_reason : null,
    };
  });
  let error: ProviderError | null =
    payload.error && typeof payload.error === 'object' ? (payload.error as ProviderError) : null;
  if (!response.ok && error === null) {
    error = {
      message: body.slice(0, 500),
      type: 'http_error',
      code: `http_${response.status}`,
    };
  }
  return {
    fixture_id: row.id,
    purpose,
    rep: 1,
    status: response.status,
    ok: response.ok && error === null,
    elapsed_s: elapsed,
    response_bytes: Buffer.byteLength(body),
    content_type: response.headers.get('content-type') ?? undefined,
    page_count: typeof payload.page_count === 'number' ? payload.page_count : null,
    pages,
    usage: payload.usage && typeof payload.usage === 'object' ? (payload.usage as Usage) : null,
    error,
  };
}

function printLiveDelta(metrics: RunMetrics[], baseline: BaselineFile | null): void {
  if (!baseline) {
    console.log('\nNo baseline found; live metrics are reported without comparison.');
    return;
  }
  console.log('\n=== LIVE DELTA VS OFFLINE BASELINE ===');
  for (const purpose of ['text_recognition', 'rich_layout_recognition'] as const) {
    const current = aggregate(metrics, purpose);
    const before = baseline.aggregates[purpose];
    if (!before || current.runs === 0) continue;
    const label = purpose === 'text_recognition' ? 'std ' : 'rich';
    const delta = (now: number | null, then: number | null): string =>
      now === null || then === null ? '-' : (now - then).toFixed(3);
    console.log(
      `${label} recall=${formatNumber(current.token_recall)} (${delta(current.token_recall, before.token_recall)}) ` +
        `prec=${formatNumber(current.token_precision)} (${delta(current.token_precision, before.token_precision)}) ` +
        `seq=${formatNumber(current.sequence_ratio)} (${delta(current.sequence_ratio, before.sequence_ratio)}) ` +
        `line=${formatNumber(current.line_token_coverage)} (${delta(current.line_token_coverage, before.line_token_coverage)}) ` +
        `empty=${current.empty_rate.toFixed(2)} (${(current.empty_rate - before.empty_rate).toFixed(2)})`
    );
  }
}

function parseList(value: string | undefined): string[] {
  return value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function runLive(
  manifest: ManifestRow[],
  fixtures: Record<string, GroundTruthFixture>,
  baseline: BaselineFile | null
): Promise<void> {
  if (!process.argv.includes('--confirm-paid')) {
    fail('Live evaluation costs money. Re-run with --live --confirm-paid to authorize requests.');
  }
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) fail('DEEPSEEK_API_KEY is not set');

  const fixtureFilter = new Set(parseList(argValue('--fixtures')));
  const purposeFilter = new Set(parseList(argValue('--purposes')));
  const repsValue = Number.parseInt(argValue('--reps') ?? '1', 10);
  const reps = Number.isFinite(repsValue) && repsValue > 0 ? repsValue : 1;
  const timeoutValue = Number.parseInt(argValue('--timeout') ?? '240000', 10);
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue >= 1000 ? timeoutValue : 240000;
  const selected = manifest.filter((row) => fixtureFilter.size === 0 || fixtureFilter.has(row.id));
  if (selected.length === 0) fail('No fixtures selected');

  const planned: Array<{ row: ManifestRow; purpose: OcrPurpose }> = [];
  for (const row of selected) {
    const purposes = row.purposes.filter(
      (purpose) => purposeFilter.size === 0 || purposeFilter.has(purpose)
    );
    for (const purpose of purposes) planned.push({ row, purpose });
  }
  if (planned.length === 0) fail('No purposes selected');

  const pages = planned.reduce((sum, item) => {
    const value = Number(item.row.pages);
    return sum + (Number.isFinite(value) && value > 0 ? value : 1);
  }, 0);
  console.log(
    `Live run: ${planned.length} requests x ${reps} repetitions (${planned.length * reps} total). ` +
      `About ${pages * reps} source pages. Billing applies to successfully recognized pages.`
  );

  mkdirSync(RUNS_DIR, { recursive: true });
  const started = new Date().toISOString();
  const runs: RecordedRun[] = [];
  let stopped = false;
  for (const item of planned) {
    for (let rep = 1; rep <= reps; rep += 1) {
      const run = await postOnce(item.row, item.purpose, key, timeoutMs);
      run.rep = rep;
      runs.push(run);
      const finish = run.pages.map((page) => page.finish_reason).join(',');
      console.log(
        `${run.fixture_id} ${run.purpose} rep=${rep} status=${run.status ?? '-'} ` +
          `ok=${run.ok} pages=${run.page_count ?? run.pages.length} ` +
          `finish=${finish || '-'} chars=${run.pages.reduce((sum, page) => sum + page.text.length, 0)}`
      );
      if (run.status === 401 || run.status === 402) {
        console.log('Stopping on authentication or balance failure.');
        stopped = true;
        break;
      }
    }
    if (stopped) break;
  }

  const stamp = started.replace(/[:.]/g, '-');
  const out = argValue('--out') ?? join(RUNS_DIR, `run-${stamp}.json`);
  const recording: RecordingFile = {
    schema_version: '1.0',
    recorded_at: started,
    source: 'Live DeepSeek OCR API run from tools/eval.ts',
    notes:
      'Authorized live run; provider behavior is variable and not a deterministic pass/fail score.',
    run_count: runs.length,
    runs,
  };
  writeFileSync(out, `${JSON.stringify(recording, null, 2)}\n`, 'utf8');
  console.log(`\nWrote ${out} (${runs.length} runs)`);

  const result = evaluateRecordings(manifest, fixtures, runs, false);
  printMetrics(result.metrics);
  printEvidence(result.metrics, fixtures);
  printLiveDelta(result.metrics, baseline);
  if (stopped) process.exitCode = 1;
  if (result.verification.failures.length > 0) {
    console.error(`\nFAIL: ${result.verification.failures.length} parser invariant failure(s)`);
    for (const message of result.verification.failures.slice(0, 50)) console.error(`- ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nParser invariants: PASS (${result.verification.checks} checks)`);
}

function runOffline(manifest: ManifestRow[], fixtures: Record<string, GroundTruthFixture>): void {
  const { files, runs } = loadRecordings();
  if (runs.length === 0) fail('no recordings found');
  const { metrics, verification } = evaluateRecordings(manifest, fixtures, runs, true);

  printMetrics(metrics);
  printEvidence(metrics, fixtures);

  const update = process.argv.includes('--update-baseline');
  let baseline: BaselineFile | null = null;
  if (existsSync(BASELINE_PATH)) baseline = readJson<BaselineFile>(BASELINE_PATH);

  if (verification.failures.length > 0) {
    console.error(`\nFAIL: ${verification.failures.length} parser invariant failure(s)`);
    for (const message of verification.failures.slice(0, 50)) console.error(`- ${message}`);
    if (update) console.error('Baseline was not updated because invariants failed.');
    process.exitCode = 1;
  } else {
    console.log(`Parser invariants: PASS (${verification.checks} checks)`);
  }

  if (update && verification.failures.length === 0) {
    baseline = writeBaseline(files, metrics, fixtures, verification);
    console.log(`\nUpdated baseline: ${relative(BASELINE_PATH)} (${metrics.length} runs)`);
  } else if (!baseline && verification.failures.length === 0) {
    fail(
      `baseline is missing: ${relative(BASELINE_PATH)}. Run with --update-baseline after reviewing the metrics.`
    );
  } else if (baseline && !update) {
    const diffs = compareBaseline(baseline, metrics);
    if (diffs.length > 0) {
      console.error(`\nFAIL: ${diffs.length} baseline difference(s)`);
      for (const message of diffs.slice(0, 50)) console.error(`- ${message}`);
      process.exitCode = 1;
    } else {
      console.log(`\nBaseline: PASS (${metrics.length} runs match ${relative(BASELINE_PATH)})`);
    }
  }
}

function relative(path: string): string {
  return path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length + 1) : path;
}

function usage(): void {
  console.log(`Usage:
  npx tsx tests/ocr-eval/tools/eval.ts                 # offline checks and baseline comparison
  npx tsx tests/ocr-eval/tools/eval.ts --update-baseline
  npx tsx tests/ocr-eval/tools/eval.ts --live --confirm-paid [options]

Offline options:
  --update-baseline        Replace reports/offline_baseline.json after reviewing changes.

Live options (both --live and --confirm-paid are required):
  --fixtures T16,T23       Limit fixtures by ID.
  --purposes text_recognition,rich_layout_recognition
  --reps 1                 Repetitions per fixture and purpose.
  --timeout 240000         Per-request timeout in milliseconds.
  --out path.json          Write the live recording elsewhere.

Live runs read DEEPSEEK_API_KEY and incur provider charges.`);
}

function main(): void {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }
  const manifest = loadManifest();
  const groundTruth = readJson<GroundTruthFile>(GROUND_TRUTH_PATH);
  const fixtures = groundTruth.fixtures;
  if (groundTruth.schema_version !== '2.0')
    fail(`unexpected ground-truth schema ${groundTruth.schema_version}`);

  const live = process.argv.includes('--live');
  if (live && process.argv.includes('--update-baseline')) {
    fail('--update-baseline is offline-only; review live metrics before changing the baseline');
  }
  if (live) {
    void runLive(
      manifest,
      fixtures,
      existsSync(BASELINE_PATH) ? readJson<BaselineFile>(BASELINE_PATH) : null
    ).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  } else {
    runOffline(manifest, fixtures);
  }
}

main();
