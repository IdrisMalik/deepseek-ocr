/** Shared application state and derived selectors. */
import { loadKey } from '../services/settings.js';
import type { FileItem, FileOcrResult, OcrPurpose } from '../services/api/types.js';
import { demoMode } from '../utils/config.js';
import { hasTruncatedPages, resultToText } from '../utils/format.js';

export type State = {
  items: FileItem[];
  activeId: string | null;
  processing: boolean;
  apiKey: string;
  demo: boolean;
  /** Edit made in the combined "All files" view, which has no single file to own it. */
  combinedEdit: string | null;
};

export const state: State = {
  items: [],
  activeId: null,
  processing: false,
  apiKey: loadKey(),
  demo: demoMode(),
  combinedEdit: null,
};

export type SuccessfulItem = FileItem & { result: FileOcrResult };

export function successfulItems(): SuccessfulItem[] {
  return state.items.filter((item): item is SuccessfulItem => item.result !== null);
}

/** Files that still need a successful extraction. */
export function pendingItems(): FileItem[] {
  return state.items.filter((item) => item.status !== 'done');
}

/* ----------------------- Extraction transitions ----------------------- */

/**
 * Queue a new attempt without discarding the last successful output. Only a
 * successful response commits a replacement; failures and cancellation leave
 * the committed result and any manual edit in place.
 */
export function beginExtraction(item: FileItem): void {
  item.status = 'ready';
  item.error = null;
}

/** Commit a successful attempt and replace the previous output. */
export function commitExtraction(item: FileItem, result: FileOcrResult, purpose: OcrPurpose): void {
  item.result = result;
  item.purpose = purpose;
  item.editedText = null;
  item.error = null;
  item.status = 'done';
}

/** Record a failed attempt while preserving any committed output. */
export function failExtraction(item: FileItem, message: string): void {
  item.status = 'error';
  item.error = message;
}

/** Record a cancelled attempt while preserving any committed output. */
export function cancelExtraction(item: FileItem): void {
  item.status = 'cancelled';
}

/** Clear committed output because the input itself changed, such as rotation. */
export function resetForInputChange(item: FileItem): void {
  item.status = 'ready';
  item.purpose = null;
  item.error = null;
  item.result = null;
  item.editedText = null;
}

/**
 * Completed files in the active view whose Standard result was truncated and
 * can be retried with Rich layout. Rich results are excluded so the retry
 * action is only offered when it has work to do.
 */
export function richLayoutRetryItems(): SuccessfulItem[] {
  const completed = successfulItems();
  const visible =
    state.activeId === 'all' ? completed : completed.filter((item) => item.id === state.activeId);
  return visible.filter(
    (item) => item.purpose !== 'rich_layout_recognition' && hasTruncatedPages([item.result])
  );
}

function itemText(item: FileItem): string {
  if (item.editedText !== null) return item.editedText;
  if (!item.result) return '';
  return resultToText(item.result);
}

export function combinedText(): string {
  return successfulItems()
    .map((item) => `## ${item.name}\n\n${itemText(item)}`)
    .join('\n\n---\n\n');
}

export function currentText(): string {
  if (state.activeId === 'all') return state.combinedEdit ?? combinedText();
  const item = state.items.find((i) => i.id === state.activeId);
  return item ? itemText(item) : '';
}
