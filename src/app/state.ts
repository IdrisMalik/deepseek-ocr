/** Application state and derived selectors. The whole app shares this tree. */
import { loadKey } from '../services/settings.js';
import type { FileItem, FileOcrResult } from '../services/api/types.js';
import { demoMode } from '../utils/config.js';
import { resultToText } from '../utils/format.js';

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
  return state.items.filter(
    (item): item is SuccessfulItem => item.result !== null && item.result.error === undefined
  );
}

export function itemText(item: FileItem): string {
  if (item.editedText !== null) return item.editedText;
  if (!item.result) return '';
  return resultToText(item.result, true);
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
