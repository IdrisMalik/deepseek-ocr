/** Application shell: DOM wiring, file intake and the OCR workflow. */
import {
  OcrClientError,
  recognizeFileOnce,
  toOcrFile,
  verifyApiKey,
} from '../services/api/client.js';
import { extensionForMime } from '../services/formats.js';
import {
  createItemId,
  forgetImage,
  isDocument,
  loadDecodedImage,
  MAX_FILES,
  renderProcessed,
  resolveMimeType,
  validateFile,
  validateFileContent,
} from '../services/files.js';
import { clearKey, saveKey } from '../services/settings.js';
import { mapWithRetries } from '../utils/queue.js';
import { clientConfig } from '../utils/config.js';
import {
  describeStats,
  downloadText,
  toMarkdownExport,
  toPlainTextExport,
} from '../utils/format.js';
import type { FileItem, FileOcrResult, OcrPurpose } from '../services/api/types.js';
import { t } from '../i18n/index.js';
import { toast } from '../components/base/Toast.js';
import { renderAttachments } from '../components/files/FileCard.js';
import { renderResult } from '../components/result/ResultPanel.js';
import { state, successfulItems } from './state.js';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

const dom = {
  main: el<HTMLElement>('main'),
  modeBadge: el<HTMLSpanElement>('modeBadge'),
  keyButton: el<HTMLButtonElement>('keyButton'),
  keyPanel: el<HTMLDivElement>('keyPanel'),
  keyInput: el<HTMLInputElement>('keyInput'),
  keySave: el<HTMLButtonElement>('keySave'),
  keyClear: el<HTMLButtonElement>('keyClear'),
  keyStatus: el<HTMLSpanElement>('keyStatus'),
  privacyButton: el<HTMLButtonElement>('privacyButton'),
  privacyNote: el<HTMLDivElement>('privacyNote'),
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
  textEditor: el<HTMLTextAreaElement>('textEditor'),
  revertButton: el<HTMLButtonElement>('revertButton'),
  copyButton: el<HTMLButtonElement>('copyButton'),
  exportTxtButton: el<HTMLButtonElement>('exportTxtButton'),
  exportMdButton: el<HTMLButtonElement>('exportMdButton'),
  textStats: el<HTMLSpanElement>('textStats'),
  truncatedNotice: el<HTMLParagraphElement>('truncatedNotice'),
};

let batchController: AbortController | null = null;
/** Incremented whenever files/state are cleared so stale async work is ignored. */
let batchGeneration = 0;
/** Invalidates queued and in-flight file intake when Clear All runs. */
let intakeGeneration = 0;
/** Number of queued or running intake batches; keeps Extract disabled until they settle. */
let intakePending = 0;
let intakeQueue: Promise<void> = Promise.resolve();
/** Invalidates an in-flight key verification when the key is changed or removed. */
let keyGeneration = 0;
let dragDepth = 0;

function selectedPurpose(): OcrPurpose {
  const checked = document.querySelector<HTMLInputElement>('input[name="purpose"]:checked');
  return checked?.value === 'rich_layout_recognition' ? 'rich_layout_recognition' : 'text_recognition';
}

/* --------------------------- Rendering --------------------------- */

function renderProgress(): void {
  const intakeBusy = intakePending > 0;
  dom.progressWrap.hidden = !state.processing;
  dom.composer.classList.toggle('is-processing', state.processing);
  dom.cancelButton.hidden = !state.processing;
  dom.extractButton.disabled = state.processing || intakeBusy || state.items.length === 0;
  dom.extractButton.classList.toggle('busy', state.processing);
  dom.extractLabel.textContent = state.processing ? t('processing') : t('extractText');
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
  renderAttachments({ onRemove: removeItem, onRetry: (id) => void runOcr([id]), onAdd: browse });
  renderProgress();
  renderResult();
}

/* --------------------------- Mutations --------------------------- */

function browse(): void {
  dom.fileInput.click();
}

async function addFiles(files: File[], generation: number): Promise<void> {
  const problems: string[] = [];

  for (const file of files) {
    if (generation !== intakeGeneration) return;
    if (state.items.length >= MAX_FILES) {
      problems.push(t('maxFiles', { count: MAX_FILES }));
      break;
    }
    const problem = validateFile(file);
    if (problem) {
      problems.push(problem);
      continue;
    }

    const mimeType = resolveMimeType(file);
    try {
      await validateFileContent(file, mimeType);
    } catch (error) {
      if (generation !== intakeGeneration) return;
      problems.push(error instanceof Error ? error.message : t('couldNotVerify', { name: file.name }));
      continue;
    }
    if (generation !== intakeGeneration) return;

    // Documents render as a type tile and never need an object URL.
    const previewUrl = mimeType.startsWith('image/') ? URL.createObjectURL(file) : '';
    const item: FileItem = {
      id: createItemId(),
      name: file.name,
      size: file.size,
      mimeType,
      blob: file,
      previewUrl,
      naturalWidth: 0,
      naturalHeight: 0,
      rotation: 0,
      scale: 1,
      crop: null,
      status: 'ready',
      error: null,
      result: null,
      editedText: null,
    };

    // Non-raster inputs are sent as-is; only images need a raster decode.
    if (!isDocument(item)) {
      try {
        const image = await loadDecodedImage(item);
        item.naturalWidth = image.naturalWidth;
        item.naturalHeight = image.naturalHeight;
      } catch (error) {
        if (generation !== intakeGeneration) {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
          forgetImage(item.id);
          return;
        }
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        forgetImage(item.id);
        problems.push(error instanceof Error ? error.message : t('couldNotRead', { name: file.name }));
        continue;
      }
    }

    if (generation !== intakeGeneration) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      forgetImage(item.id);
      return;
    }

    state.items.push(item);
    if (state.activeId === null) state.activeId = item.id;
    // Show each accepted file as soon as it is validated and decoded.
    renderAll();
  }

  if (generation !== intakeGeneration) return;
  renderAll();
  if (problems.length) toast(problems[0], 'error');
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
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  forgetImage(item.id);

  if (state.activeId === id) {
    const next = successfulItems()[0] ?? state.items[0];
    state.activeId = next?.id ?? null;
  }
  // The combined view is derived from the remaining files; a stored edit would be stale.
  state.combinedEdit = null;
  if (state.items.length === 0) {
    dom.progressWrap.hidden = true;
    dom.composerError.hidden = true;
  }
  renderAll();
}

/** Reset everything: files, results, editor, progress and async processing. */
function clearAll(): void {
  batchGeneration += 1;
  intakeGeneration += 1;
  batchController?.abort();
  batchController = null;
  state.processing = false;

  for (const item of state.items) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    forgetImage(item.id);
  }
  state.items = [];
  state.activeId = null;
  state.combinedEdit = null;

  dom.composerError.hidden = true;
  dom.composerError.replaceChildren();
  dom.progressWrap.hidden = true;
  dom.progressBar.setAttribute('aria-valuenow', '0');
  dom.progressFill.style.width = '0%';
  dom.textEditor.value = '';
  dom.textEditor.dataset.exportTitle = t('ocrOutput');
  dom.textStats.textContent = t('emptyStats');
  dom.truncatedNotice.hidden = true;
  dom.cancelButton.hidden = true;
  dom.extractLabel.textContent = t('extractText');
  dom.extractButton.classList.remove('busy');
  dom.main.classList.remove('has-result');
  renderAll();
}

function showComposerError(message: string, retryIds: string[]): void {
  dom.composerError.hidden = false;
  dom.composerError.replaceChildren();
  dom.composerError.append(document.createTextNode(message));
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = t('retry');
  retry.addEventListener('click', () => void runOcr(retryIds));
  dom.composerError.appendChild(retry);
}

async function runOcr(ids: string[]): Promise<void> {
  if (state.processing || intakePending > 0) return;
  const targets = state.items.filter((item) => ids.includes(item.id));
  if (targets.length === 0) return;

  if (!state.demo && !state.apiKey) {
    toggleKeyPanel(true);
    dom.keyStatus.textContent = t('noKeyStatus');
    toast(t('addKeyToast'), 'error');
    return;
  }

  const generation = batchGeneration;
  state.processing = true;
  batchController = new AbortController();
  const signal = batchController.signal;
  const purpose = selectedPurpose();
  // Keep the batch on the key that was current when it started, even if the
  // user removes or replaces it while files are still queued.
  const apiKey = state.apiKey;

  dom.composerError.hidden = true;
  state.combinedEdit = null;
  for (const item of targets) {
    item.status = 'ready';
    item.error = null;
    item.result = null;
    item.editedText = null;
  }
  if (state.activeId !== 'all' && targets.some((item) => item.id === state.activeId)) {
    state.activeId = null;
  }
  renderAll();

  let done = 0;
  setProgress(0, targets.length, t('processingLabel'));

  try {
    // The queue owns retries: a transient failure releases its slot immediately
    // and re-enters later, so unrelated files keep moving during backoff.
    const settled = await mapWithRetries(
      targets,
      async (item): Promise<FileOcrResult> => {
        item.status = 'processing';
        renderAll();
        const rendered = await renderProcessed(item);
        // Canvas re-encodes images as PNG; the sent filename must match the bytes.
        const apiName = `${item.name.replace(/\.[^.]+$/, '')}.${extensionForMime(rendered.mimeType)}`;
        return recognizeFileOnce(
          toOcrFile(apiName, rendered.dataUrl, rendered.mimeType),
          purpose,
          apiKey,
          signal
        );
      },
      {
        concurrency: clientConfig.concurrency,
        maxAttempts: clientConfig.maxAttempts,
        baseDelayMs: clientConfig.retryBaseMs,
        maxDelayMs: clientConfig.retryMaxMs,
        maxRetryAfterMs: clientConfig.retryMaxRetryAfterMs,
        jitterRatio: clientConfig.retryJitterRatio,
        isRetryable: (error) =>
          error instanceof Error && Boolean((error as { retryable?: boolean }).retryable),
        getRetryAfterMs: (error) =>
          error instanceof OcrClientError ? error.retryAfterMs : undefined,
        signal,
        onTerminal: (index, outcome) => {
          if (generation !== batchGeneration) return;
          const item = targets[index];
          if (outcome.status === 'fulfilled') {
            item.result = outcome.value;
            item.status = 'done';
            if (state.activeId === null) state.activeId = item.id;
          } else {
            item.status = 'error';
            item.error =
              outcome.reason instanceof Error ? outcome.reason.message : t('couldNotExtract');
          }
          done += 1;
          setProgress(done, targets.length, signal.aborted ? t('cancelling') : t('processingLabel'));
          // Apply the file result immediately so completed thumbnails do not
          // keep showing a processing spinner until the whole batch ends.
          renderAll();
        },
      }
    );

    // A clear (or a new batch) while this batch was in flight invalidates all
    // outcomes: never write stale results into fresh state.
    if (generation !== batchGeneration) return;

    // Every normal terminal outcome was applied by onTerminal above. Mark
    // tasks that were skipped or in flight at cancellation, and keep a
    // defensive fallback for any outcome a callback could not apply.
    settled.forEach((entry, index) => {
      const item = targets[index];
      if (item.status === 'done' || item.status === 'error' || item.status === 'cancelled') return;
      if (signal.aborted) {
        item.status = 'cancelled';
        return;
      }
      if (entry.status === 'fulfilled') {
        item.result = entry.value;
        item.status = 'done';
        if (state.activeId === null) state.activeId = item.id;
      } else {
        item.status = 'error';
        item.error = entry.reason instanceof Error ? entry.reason.message : t('couldNotExtract');
      }
    });

    const cancelled = targets.some((item) => item.status === 'cancelled');
    // Every file now has a terminal outcome, including queued items skipped on cancel.
    done = targets.length;
    setProgress(done, targets.length, cancelled ? t('cancelled') : t('finished'));
    renderAll();

    if (!cancelled) {
      const failed = targets.filter((item) => item.status === 'error');
      if (failed.length > 0 && failed.length === targets.length) {
        showComposerError(failed[0].error ?? t('couldNotExtract'), ids);
      } else if (failed.length > 0) {
        toast(
          failed.length === 1 ? t('failedOne') : t('failedMany', { count: failed.length }),
          'error'
        );
      }
    } else {
      toast(t('cancelledToast'));
    }
  } catch (error) {
    if (generation === batchGeneration) {
      // Exceptions outside per-file workers must not disappear as unhandled
      // promise rejections from the fire-and-forget call sites.
      showComposerError(
        error instanceof Error ? error.message : t('somethingWrong'),
        ids
      );
    }
  } finally {
    // A newer batch or a clear owns the state now; do not clobber it.
    if (generation === batchGeneration) {
      state.processing = false;
      batchController = null;
      renderAll();
    }
  }
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

dom.extractButton.addEventListener('click', () => {
  void runOcr(state.items.map((item) => item.id));
});
dom.cancelButton.addEventListener('click', cancelProcessing);
dom.clearButton.addEventListener('click', clearAll);

dom.privacyButton.addEventListener('click', () => {
  const open = dom.privacyNote.hidden;
  dom.privacyNote.hidden = !open;
  dom.privacyButton.setAttribute('aria-expanded', String(open));
});

function updateBadge(): void {
  if (state.demo) {
    dom.modeBadge.textContent = t('demoBadge');
    dom.modeBadge.className = 'mode-badge mock';
    dom.modeBadge.title = t('demoBadgeTitle');
  } else if (state.apiKey) {
    dom.modeBadge.textContent = t('liveBadge');
    dom.modeBadge.className = 'mode-badge live';
    dom.modeBadge.title = t('liveBadgeTitle');
  } else {
    dom.modeBadge.textContent = t('addKeyBadge');
    dom.modeBadge.className = 'mode-badge mock';
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

function toggleKeyPanel(open: boolean): void {
  dom.keyPanel.hidden = !open;
  dom.keyButton.setAttribute('aria-expanded', String(open));
  if (open) {
    dom.keyInput.value = state.apiKey;
    updateKeyStatus();
    dom.keyInput.focus();
  }
}

dom.keyButton.addEventListener('click', () => toggleKeyPanel(dom.keyPanel.hidden));

dom.keySave.addEventListener('click', async () => {
  const key = dom.keyInput.value.trim();
  if (!key) {
    dom.keyStatus.textContent = t('enterKeyFirst');
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
  keyGeneration += 1;
  state.apiKey = '';
  dom.keyInput.value = '';
  dom.keySave.disabled = false;
  clearKey();
  updateBadge();
  updateKeyStatus();
  toast(t('keyRemoved'));
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
  downloadText(`${title}.txt`, toPlainTextExport(title, dom.textEditor.value), 'text/plain;charset=utf-8');
});
dom.exportMdButton.addEventListener('click', () => {
  const title = dom.textEditor.dataset.exportTitle ?? t('ocrOutput');
  downloadText(`${title}.md`, toMarkdownExport(title, dom.textEditor.value), 'text/markdown;charset=utf-8');
});

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    if (!dom.extractButton.disabled) {
      void runOcr(state.items.map((item) => item.id));
    }
  }
});

/** Mount the application into the existing static markup. */
export function mountApp(): void {
  dom.fileInput.accept = clientConfig.accept;
  dom.keyInput.value = state.apiKey;
  updateBadge();
  updateKeyStatus();
  renderAll();
}
