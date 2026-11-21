/**
 * Pure extraction transitions for `FileItem`.
 *
 * Kept separate from the state singleton so the batch workflow can import them
 * without loading browser storage or any other application state.
 */
import type { FileItem, FileOcrResult, OcrPurpose } from '../services/api/types.js';

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
