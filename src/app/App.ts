/** Application shell: DOM wiring, file intake, and presentation orchestration. */
import { verifyApiKey } from '../services/api/client.js';
import {
  canPreview,
  createItemId,
  forgetImage,
  MAX_FILES,
  resolveMimeType,
  validateFile,
  validateFileContent,
} from '../services/files.js';
import { clearKey, saveKey } from '../services/settings.js';
import {
  describeStats,
  downloadText,
  toMarkdownExport,
  toPlainTextExport,
} from '../utils/format.js';
import type { FileItem, OcrPurpose } from '../services/api/types.js';
import { t } from '../i18n/index.js';
import { toast } from '../components/base/Toast.js';
import { focusAttachment, renderAttachments } from '../components/files/FileCard.js';
import { renderResult } from '../components/result/ResultPanel.js';
import { setKeyVisibility } from '../components/settings/keyVisibility.js';
import {
  beginExtraction,
  pendingItems,
  resetForInputChange,
  richLayoutRetryItems,
  state,
  successfulItems,
} from './state.js';
import { runOcrBatch } from './ocrBatch.js';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

const dom = {
  modeBadge: el<HTMLSpanElement>('modeBadge'),
  keyButton: el<HTMLButtonElement>('keyButton'),
  keyPanel: el<HTMLDivElement>('keyPanel'),
  keyInput: el<HTMLInputElement>('keyInput'),
  keyVisibility: el<HTMLButtonElement>('keyVisibility'),
  keySave: el<HTMLButtonElement>('keySave'),
  keyClear: el<HTMLButtonElement>('keyClear'),
  keyStatus: el<HTMLSpanElement>('keyStatus'),
  keyClose: el<HTMLButtonElement>('keyClose'),
  privacyButton: el<HTMLButtonElement>('privacyButton'),
  privacyNote: el<HTMLDivElement>('privacyNote'),
  privacyClose: el<HTMLButtonElement>('privacyClose'),
  composer: el<HTMLElement>('composer'),
  clearButton: el<HTMLButtonElement>('clearButton'),
  browseLink: el<HTMLButtonElement>('browseLink'),
  fileInput: el<HTMLInputElement>('fileInput'),
  progressWrap: el<HTMLDivElement>('progressWrap'),
  progressLabel: el<HTMLSpanElement>('progressLabel'),
  progressCount: el<HTMLSpanElement>('progressCount'),
  progressBar: el<HTMLDivElement>('progressBar'),
  progressFill: el<HTMLDivElement>('progressFill'),
  composerError: el<HTMLParagraphElement>('composerError'),
  cancelButton: el<HTMLButtonElement>('cancelButton'),
  extractButton: el<HTMLButtonElement>('extractButton'),
  extractLabel: el<HTMLSpanElement>('extractLabel'),
  modeRich: el<HTMLInputElement>('modeRich'),
  textEditor: el<HTMLTextAreaElement>('textEditor'),
  revertButton: el<HTMLButtonElement>('revertButton'),
  copyButton: el<HTMLButtonElement>('copyButton'),
  exportTxtButton: el<HTMLButtonElement>('exportTxtButton'),
  exportMdButton: el<HTMLButtonElement>('exportMdButton'),
  textStats: el<HTMLSpanElement>('textStats'),
  layoutRetryButton: el<HTMLButtonElement>('layoutRetryButton'),
};

let batchController: AbortController | null = null;
/** Incremented whenever files/state are cleared so stale async work is ignored. */
let batchGeneration = 0;
/** Invalidates queued and in-flight file intake when the list is cleared. */
let intakeGeneration = 0;
/** Number of queued or running intake batches; keeps Extract disabled until they settle. */
let intakePending = 0;
let intakeQueue: Promise<void> = Promise.resolve();
/**
 * Invalidates an in-flight key verification when a new key is saved or the
 * current key is removed.
 */
let keyGeneration = 0;
let dragDepth = 0;
let multiFrameNoticeShown = false;

function selectedPurpose(): OcrPurpose {
  return dom.modeRich.checked ? 'rich_layout_recognition' : 'text_recognition';
}

/** Input types that do not accept typed or numeric entry. */
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** True when a focused control owns keyboard input for editing or selection. */
function isEditingControl(target: Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/* --------------------------- Rendering --------------------------- */

function renderProgress(): void {
  const intakeBusy = intakePending > 0;
  dom.progressWrap.hidden = !state.processing;
  if (!state.processing) {
    dom.progressBar.setAttribute('aria-valuenow', '0');
    dom.progressFill.style.width = '0%';
  }
  dom.composer.classList.toggle('is-processing', state.processing);
  dom.cancelButton.hidden = !state.processing;
  dom.extractButton.disabled = state.processing || intakeBusy || state.items.length === 0;
  dom.extractButton.classList.toggle('busy', state.processing);
  const allDone = state.items.length > 0 && pendingItems().length === 0;
  const label = state.processing ? t('processing') : allDone ? t('reextractAll') : t('extractText');
  dom.extractLabel.textContent = label;
  dom.extractButton.setAttribute('aria-label', label);
  dom.extractButton.title = label;
}

function setProgress(done: number, total: number, label: string): void {
  dom.progressWrap.hidden = false;
  dom.progressLabel.textContent = label;
  dom.progressCount.textContent = total > 0 ? `${done} of ${total}` : '';
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  dom.progressFill.style.width = `${percent}%`;
  dom.progressBar.setAttribute('aria-valuenow', String(percent));
}

function renderAll(): void {
  renderAttachments({
    onRemove: removeItem,
    onRetry: (id) => void runOcr([id], true),
    onRotate: rotateItem,
    onAdd: browse,
  });
  renderProgress();
  renderResult();
}

/* --------------------------- Mutations --------------------------- */

function browse(): void {
  dom.fileInput.click();
}

function disposeItem(item: FileItem): void {
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  forgetImage(item.id);
}

async function addFiles(files: File[], generation: number): Promise<void> {
  let problem: string | null = null;

  for (const file of files) {
    if (generation !== intakeGeneration) return;
    if (state.items.length >= MAX_FILES) {
      problem ??= t('maxFiles', { count: MAX_FILES });
      break;
    }
    const validation = validateFile(file);
    if (validation) {
      problem ??= validation;
      continue;
    }

    const mimeType = resolveMimeType(file);
    try {
      await validateFileContent(file, mimeType);
    } catch (error) {
      if (generation !== intakeGeneration) return;
      problem ??= error instanceof Error ? error.message : t('couldNotVerify', { name: file.name });
      continue;
    }
    if (generation !== intakeGeneration) return;

    // Documents (including TIFF) render as a type tile and need no object URL.
    const previewUrl = canPreview(mimeType) ? URL.createObjectURL(file) : '';
    const item: FileItem = {
      id: createItemId(),
      name: file.name,
      size: file.size,
      mimeType,
      blob: file,
      previewUrl,
      rotation: 0,
      status: 'ready',
      purpose: null,
      error: null,
      result: null,
      editedText: null,
    };

    state.items.push(item);
    if (state.activeId === null) state.activeId = item.id;
    if (!multiFrameNoticeShown && (mimeType === 'image/tiff' || mimeType === 'image/gif')) {
      multiFrameNoticeShown = true;
      toast(t('multiFrameNotice'));
    }
    // Show each accepted file as soon as it is validated.
    renderAll();
  }

  if (problem) toast(problem, 'error');
}

/** Serialize intake so concurrent drops/pastes cannot race the file limit. */
function enqueueFiles(files: File[]): void {
  if (files.length === 0) return;
  intakePending += 1;
  renderAll();
  const generation = intakeGeneration;
  const run = intakeQueue.then(() => addFiles(files, generation));
  intakeQueue = run
    .catch((error: unknown) => {
      toast(error instanceof Error ? error.message : t('somethingWrong'), 'error');
    })
    .finally(() => {
      intakePending -= 1;
      if (intakePending === 0) renderAll();
    });
}

function removeItem(id: string): void {
  const index = state.items.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [item] = state.items.splice(index, 1);
  disposeItem(item);

  if (state.activeId === id) {
    const next = successfulItems()[0] ?? state.items[0];
    state.activeId = next?.id ?? null;
  }
  // The combined view is derived from the remaining files; a stored edit would be stale.
  state.combinedEdit = null;
  if (state.items.length === 0) dom.composerError.hidden = true;
  renderAll();

  // Removing a thumbnail rebuilds the strip, so restore focus explicitly.
  if (state.items.length > 0) {
    const next = state.items[Math.min(index, state.items.length - 1)];
    focusAttachment(next.id, 'remove');
  } else {
    dom.browseLink.focus();
  }
}

/** Rotation invalidates any extracted text, because the input has changed. */
function rotateItem(id: string): void {
  const item = state.items.find((candidate) => candidate.id === id);
  if (!item || state.processing) return;

  item.rotation = (item.rotation + 90) % 360;
  const invalidates = item.result !== null || item.editedText !== null || item.status !== 'ready';
  if (invalidates) {
    resetForInputChange(item);
    forgetImage(item.id);
    state.combinedEdit = null;
    if (state.activeId === item.id) {
      state.activeId = successfulItems()[0]?.id ?? null;
    }
    toast(t('rotationReset'));
  }
  renderAll();
}

/** Reset files, results, editor, progress and async processing. */
function clearAll(): void {
  batchGeneration += 1;
  intakeGeneration += 1;
  batchController?.abort();
  batchController = null;
  state.processing = false;

  for (const item of state.items) disposeItem(item);
  state.items = [];
  state.activeId = null;
  state.combinedEdit = null;

  dom.composerError.hidden = true;
  dom.composerError.replaceChildren();
  renderAll();
  dom.browseLink.focus();
}

function showComposerError(message: string, retryIds: string[]): void {
  dom.composerError.hidden = false;
  dom.composerError.replaceChildren();
  dom.composerError.append(document.createTextNode(message));
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = t('retry');
  retry.addEventListener('click', () => void runOcr(retryIds, true));
  dom.composerError.appendChild(retry);
}

async function runOcr(ids: string[], focusCancel = false): Promise<void> {
  if (state.processing || intakePending > 0) return;
  const targets = state.items.filter((item) => ids.includes(item.id));
  if (targets.length === 0) return;

  if (!state.demo && !state.apiKey) {
    setKeyPanel(true);
    toast(t('addKeyToast'), 'error');
    return;
  }

  const generation = batchGeneration;
  state.processing = true;
  batchController = new AbortController();
  const signal = batchController.signal;
  const purpose = selectedPurpose();
  // Keep the batch on the key that was current when it started. Replacing the
  // key does not change in-flight work; removing it cancels the batch.
  const apiKey = state.apiKey;

  dom.composerError.hidden = true;
  // Keep the committed result and any edit until a replacement succeeds.
  for (const item of targets) beginExtraction(item);
  renderAll();
  if (focusCancel) dom.cancelButton.focus();

  setProgress(0, targets.length, t('processingLabel'));

  try {
    const summary = await runOcrBatch({
      items: targets,
      purpose,
      apiKey,
      signal,
      formatError: (error) => (error instanceof Error ? error.message : t('couldNotExtract')),
      onItemChange: (item) => {
        if (generation !== batchGeneration) return;
        if (item.status === 'done') {
          // Any committed replacement makes a manually edited combined view stale.
          state.combinedEdit = null;
          if (state.activeId === null) state.activeId = item.id;
        }
        // Apply the file result immediately so completed thumbnails do not
        // keep showing a processing spinner until the whole batch ends.
        renderAll();
      },
      onProgress: (done, total, aborted) => {
        if (generation !== batchGeneration) return;
        setProgress(done, total, aborted ? t('cancelling') : t('processingLabel'));
      },
    });

    // A clear while this batch is in flight invalidates its outcomes; never
    // write stale results into fresh state.
    if (generation !== batchGeneration) return;

    // Every file now has a terminal outcome, including queued items skipped on cancel.
    setProgress(targets.length, targets.length, summary.cancelled ? t('cancelled') : t('finished'));
    renderAll();

    if (!summary.cancelled) {
      if (summary.failures.length > 0 && summary.failures.length === targets.length) {
        showComposerError(summary.failures[0].error ?? t('couldNotExtract'), ids);
      } else if (summary.failures.length > 0) {
        toast(
          summary.failures.length === 1
            ? t('failedOne')
            : t('failedMany', { count: summary.failures.length }),
          'error'
        );
      }
    } else {
      toast(t('cancelledToast'));
    }
  } catch (error) {
    if (generation === batchGeneration) {
      // Report orchestration errors; runOcr is fire-and-forget at its call sites.
      showComposerError(error instanceof Error ? error.message : t('somethingWrong'), ids);
    }
  } finally {
    // If a clear superseded this batch, leave the new state alone.
    const cancelFocused = document.activeElement === dom.cancelButton;
    if (generation === batchGeneration) {
      state.processing = false;
      batchController = null;
      renderAll();
      if (cancelFocused) dom.extractButton.focus();
    }
  }
}

/** Extract pending files, or every file once the batch is already complete. */
function startExtraction(): void {
  const pending = pendingItems();
  const targets = pending.length > 0 ? pending : state.items;
  if (targets.length === 0) return;
  void runOcr(targets.map((item) => item.id));
}

function cancelProcessing(): void {
  batchController?.abort();
  dom.progressLabel.textContent = t('cancelling');
}

/* ---------------------------- Events ----------------------------- */

dom.browseLink.addEventListener('click', browse);
dom.fileInput.addEventListener('change', () => {
  enqueueFiles(Array.from(dom.fileInput.files ?? []));
  dom.fileInput.value = '';
});

for (const eventName of ['dragenter', 'dragover']) {
  dom.composer.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (event.type === 'dragenter') dragDepth += 1;
    dom.composer.classList.add('drag-over');
  });
}
dom.composer.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dom.composer.classList.remove('drag-over');
});
dom.composer.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  dom.composer.classList.remove('drag-over');
  enqueueFiles(Array.from((event as DragEvent).dataTransfer?.files ?? []));
});
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

window.addEventListener('paste', (event) => {
  const files = Array.from(event.clipboardData?.files ?? []);
  if (files.length === 0) return;
  event.preventDefault();
  // Let the intake queue validate each file so unsupported inputs get actionable feedback.
  enqueueFiles(files);
});

dom.extractButton.addEventListener('click', startExtraction);
dom.cancelButton.addEventListener('click', cancelProcessing);
dom.clearButton.addEventListener('click', clearAll);
dom.layoutRetryButton.addEventListener('click', () => {
  const retryIds = richLayoutRetryItems().map((item) => item.id);
  if (retryIds.length === 0) return;
  dom.modeRich.checked = true;
  toast(t('retryingWithLayout'));
  void runOcr(retryIds, true);
});

function setKeyPanel(open: boolean, restoreFocus = false): void {
  if (open) setPrivacyPanel(false);
  dom.keyPanel.hidden = !open;
  dom.keyButton.setAttribute('aria-expanded', String(open));
  // Reopening or closing the key panel always restores the masked state.
  setKeyMasked();
  if (open) {
    dom.keyInput.value = state.apiKey;
    updateKeyStatus();
    dom.keyInput.focus();
  } else if (restoreFocus) {
    dom.keyButton.focus();
  }
}

function setPrivacyPanel(open: boolean, restoreFocus = false): void {
  if (open) setKeyPanel(false);
  dom.privacyNote.hidden = !open;
  dom.privacyButton.setAttribute('aria-expanded', String(open));
  if (open) {
    dom.privacyClose.focus();
  } else if (restoreFocus) {
    dom.privacyButton.focus();
  }
}

function updateBadge(): void {
  if (state.demo) {
    dom.modeBadge.textContent = t('demoBadge');
    dom.modeBadge.className = 'mode-badge demo';
    dom.modeBadge.title = t('demoBadgeTitle');
  } else if (state.apiKey) {
    dom.modeBadge.textContent = t('liveBadge');
    dom.modeBadge.className = 'mode-badge live';
    dom.modeBadge.title = t('liveBadgeTitle');
  } else {
    dom.modeBadge.textContent = t('addKeyBadge');
    dom.modeBadge.className = 'mode-badge idle';
    dom.modeBadge.title = t('addKeyBadgeTitle');
  }
}

function updateKeyStatus(): void {
  if (state.demo) {
    dom.keyStatus.textContent = t('demoKeyStatus');
  } else if (state.apiKey) {
    dom.keyStatus.textContent = t('savedKeyStatus');
  } else {
    dom.keyStatus.textContent = t('noKeyStatus');
  }
}

function setKeyMasked(): void {
  setKeyVisibility(dom.keyInput, dom.keyVisibility, false, {
    show: t('showKey'),
    hide: t('hideKey'),
  });
}

dom.keyButton.addEventListener('click', () => setKeyPanel(dom.keyPanel.hidden));
dom.keyClose.addEventListener('click', () => setKeyPanel(false, true));
dom.privacyButton.addEventListener('click', () => setPrivacyPanel(dom.privacyNote.hidden));
dom.privacyClose.addEventListener('click', () => setPrivacyPanel(false, true));

document.addEventListener('pointerdown', (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (!dom.keyPanel.hidden && !dom.keyPanel.contains(target) && !dom.keyButton.contains(target)) {
    setKeyPanel(false);
  }
  if (
    !dom.privacyNote.hidden &&
    !dom.privacyNote.contains(target) &&
    !dom.privacyButton.contains(target)
  ) {
    setPrivacyPanel(false);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!dom.keyPanel.hidden) {
    event.preventDefault();
    setKeyPanel(false, true);
  } else if (!dom.privacyNote.hidden) {
    event.preventDefault();
    setPrivacyPanel(false, true);
  }
});

dom.keyVisibility.addEventListener('click', () => {
  setKeyVisibility(dom.keyInput, dom.keyVisibility, dom.keyInput.type === 'password', {
    show: t('showKey'),
    hide: t('hideKey'),
  });
});

dom.keySave.addEventListener('click', async () => {
  const key = dom.keyInput.value.trim();
  if (!key) {
    dom.keyStatus.textContent = t('enterKeyFirst');
    return;
  }
  if (state.demo) {
    dom.keyStatus.textContent = t('demoKeyStatus');
    dom.keyInput.value = '';
    setKeyMasked();
    return;
  }
  const verification = ++keyGeneration;
  dom.keySave.disabled = true;
  dom.keyStatus.textContent = t('verifying');
  try {
    await verifyApiKey(key, AbortSignal.timeout(15000));
    // A removal or newer save happened while this request was in flight.
    if (verification !== keyGeneration) return;
    state.apiKey = key;
    saveKey(key);
    setKeyMasked();
    dom.keyStatus.textContent = t('keyVerified');
    updateBadge();
    toast(t('keySavedToast'));
  } catch (error) {
    if (verification !== keyGeneration) return;
    const message = error instanceof Error ? error.message : t('unknownError');
    dom.keyStatus.textContent = /401|invalid/i.test(message) ? t('invalidKey') : message;
  } finally {
    if (verification === keyGeneration) dom.keySave.disabled = false;
  }
});

dom.keyClear.addEventListener('click', () => {
  const wasProcessing = state.processing;
  keyGeneration += 1;
  state.apiKey = '';
  dom.keyInput.value = '';
  setKeyMasked();
  dom.keySave.disabled = false;
  clearKey();
  updateBadge();
  updateKeyStatus();
  if (wasProcessing) {
    cancelProcessing();
    toast(t('keyRemovedBatchCancelled'));
  } else {
    toast(t('keyRemoved'));
  }
});

dom.textEditor.addEventListener('input', () => {
  // Only a genuine user edit (editor focused) should override the OCR text.
  if (document.activeElement !== dom.textEditor) return;
  const active = state.items.find((i) => i.id === state.activeId);
  if (state.activeId === 'all') {
    state.combinedEdit = dom.textEditor.value;
  } else if (active) {
    active.editedText = dom.textEditor.value;
  }
  dom.textStats.textContent = describeStats(dom.textEditor.value);
  dom.revertButton.hidden =
    state.activeId === 'all' ? state.combinedEdit == null : active?.editedText == null;
});
dom.revertButton.addEventListener('click', () => {
  if (state.activeId === 'all') {
    state.combinedEdit = null;
  } else {
    const active = state.items.find((i) => i.id === state.activeId);
    if (!active) return;
    active.editedText = null;
  }
  renderResult();
});

dom.copyButton.addEventListener('click', async () => {
  const text = dom.textEditor.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast(t('copied'));
  } catch {
    dom.textEditor.focus();
    dom.textEditor.select();
    const ok = document.execCommand('copy');
    toast(ok ? t('copied') : t('copyFailed'), ok ? 'info' : 'error');
  }
});

dom.exportTxtButton.addEventListener('click', () => {
  const title = dom.textEditor.dataset.exportTitle ?? t('ocrOutput');
  downloadText(`${title}.txt`, toPlainTextExport(dom.textEditor.value), 'text/plain;charset=utf-8');
});
dom.exportMdButton.addEventListener('click', () => {
  const title = dom.textEditor.dataset.exportTitle ?? t('ocrOutput');
  downloadText(
    `${title}.md`,
    toMarkdownExport(title, dom.textEditor.value),
    'text/markdown;charset=utf-8'
  );
});

window.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
  if (event.isComposing) return;
  if (!dom.keyPanel.hidden || !dom.privacyNote.hidden) return;
  if (isEditingControl(document.activeElement)) return;
  if (dom.extractButton.disabled) return;
  event.preventDefault();
  startExtraction();
});

/** Mount the application into the existing static markup. */
export function mountApp(): void {
  dom.keyInput.value = state.apiKey;
  setKeyMasked();
  updateBadge();
  updateKeyStatus();
  renderAll();
}
