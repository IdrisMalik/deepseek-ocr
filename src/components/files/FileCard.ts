/** Source file cards: previews, status feedback and per-file actions. */
import { state } from '../../app/state.js';
import { t } from '../../i18n/index.js';
import { isDocument, MAX_FILES } from '../../services/files.js';
import { formatSize } from '../../utils/format.js';
import { icons } from '../base/icons.js';

export type FileCardActions = {
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onRotate: (id: string) => void;
  onAdd: () => void;
};

/** Focus a stable action after the attachment strip is rebuilt. */
export function focusAttachment(id: string, action: string): boolean {
  const root = document.getElementById('attachments');
  if (!root) return false;
  const thumb = Array.from(root.querySelectorAll<HTMLElement>('[data-id]')).find(
    (node) => node.dataset.id === id
  );
  const target = thumb?.querySelector<HTMLElement>(`[data-action="${action}"]`);
  if (!target) return false;
  target.focus();
  return true;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

export function renderAttachments(actions: FileCardActions): void {
  const attachments = el<HTMLDivElement>('attachments');
  const emptyPrompt = el<HTMLDivElement>('emptyPrompt');
  const fileBar = el<HTMLDivElement>('fileBar');
  const fileCount = el<HTMLSpanElement>('fileCount');
  const hasItems = state.items.length > 0;

  emptyPrompt.hidden = hasItems;
  fileBar.hidden = !hasItems;
  attachments.hidden = !hasItems;
  fileCount.textContent =
    state.items.length === 1 ? t('fileOne') : t('fileMany', { count: state.items.length });
  attachments.classList.toggle('dense', state.items.length > 8);

  // Remember the active action before replaceChildren() destroys the nodes.
  const active = document.activeElement as HTMLElement | null;
  const activeThumb = active?.closest<HTMLElement>('[data-id]');
  const activeId = activeThumb?.dataset.id;
  const activeAction = active?.dataset.action;

  attachments.replaceChildren();

  if (!hasItems) return;

  for (const item of state.items) {
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.dataset.testid = 'attachment';
    thumb.dataset.id = item.id;
    thumb.dataset.name = item.name;
    if (item.status === 'done') thumb.classList.add('done');
    if (item.status === 'error') thumb.classList.add('error');
    thumb.title = `${item.name} · ${formatSize(item.size)}`;

    if (isDocument(item)) {
      // Non-rasterizable inputs show a type tile.
      thumb.classList.add('thumb-document');
      const ext = document.createElement('span');
      ext.className = 'thumb-ext';
      ext.textContent = item.name.split('.').pop()?.toUpperCase().slice(0, 4) ?? 'FILE';
      thumb.appendChild(ext);
    } else {
      const image = document.createElement('img');
      image.src = item.previewUrl;
      image.alt = item.name;
      image.style.transform = `rotate(${item.rotation}deg)`;
      thumb.appendChild(image);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'thumb-remove';
    remove.dataset.action = 'remove';
    remove.setAttribute('aria-label', t('removeLabel', { name: item.name }));
    remove.innerHTML = icons.close;
    remove.disabled = state.processing;
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      actions.onRemove(item.id);
    });
    thumb.appendChild(remove);

    if (!state.processing && !isDocument(item)) {
      const rotate = document.createElement('button');
      rotate.type = 'button';
      rotate.className = 'thumb-rotate';
      rotate.dataset.action = 'rotate';
      rotate.setAttribute('aria-label', t('rotateLabel', { name: item.name }));
      rotate.title = t('rotate');
      rotate.innerHTML = icons.rotate;
      rotate.addEventListener('click', (event) => {
        event.stopPropagation();
        actions.onRotate(item.id);
      });
      thumb.appendChild(rotate);
    }

    if (item.status === 'processing') {
      const overlay = document.createElement('div');
      overlay.className = 'thumb-overlay';
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-label', t('processingAria'));
      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      spinner.setAttribute('aria-hidden', 'true');
      overlay.appendChild(spinner);
      thumb.appendChild(overlay);
    } else if (item.status === 'error') {
      const overlay = document.createElement('div');
      overlay.className = 'thumb-overlay';
      const text = document.createElement('span');
      text.className = 'err-text';
      text.textContent = item.error ?? t('failed');
      text.title = text.textContent;
      overlay.appendChild(text);
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'retry';
      retry.dataset.action = 'retry';
      retry.textContent = t('retry');
      retry.setAttribute('aria-label', t('retryLabel', { name: item.name }));
      retry.addEventListener('click', (event) => {
        event.stopPropagation();
        actions.onRetry(item.id);
      });
      overlay.appendChild(retry);
      thumb.appendChild(overlay);
    } else if (item.status === 'cancelled') {
      const overlay = document.createElement('div');
      overlay.className = 'thumb-overlay';
      const text = document.createElement('span');
      text.className = 'cancel-text';
      text.textContent = t('cancelled');
      overlay.appendChild(text);
      thumb.appendChild(overlay);
    } else if (item.status === 'done') {
      const badge = document.createElement('span');
      badge.className = 'thumb-badge';
      badge.innerHTML = icons.check;
      badge.setAttribute('role', 'img');
      badge.setAttribute('aria-label', t('textExtracted'));
      thumb.appendChild(badge);
    }

    attachments.appendChild(thumb);
  }

  if (state.items.length < MAX_FILES) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'thumb-add';
    add.dataset.action = 'add';
    add.setAttribute('aria-label', t('addMoreFiles'));
    add.title = t('addMoreFiles');
    add.innerHTML = icons.plus;
    add.addEventListener('click', actions.onAdd);
    attachments.appendChild(add);
  }

  // Re-focus the same action when it still exists after the rebuild.
  if (activeAction === 'add') {
    attachments.querySelector<HTMLElement>('[data-action="add"]')?.focus();
  } else if (activeId && activeAction) {
    focusAttachment(activeId, activeAction);
  }
}
