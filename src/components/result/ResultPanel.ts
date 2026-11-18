/** Extracted-text pane: result tabs, editor, stats and export actions. */
import { currentText, state, successfulItems } from '../../app/state.js';
import { t } from '../../i18n/index.js';
import { describeStats, hasTruncatedPages, safeFileStem } from '../../utils/format.js';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

export function renderResult(): void {
  const main = el<HTMLElement>('main');
  const panel = el<HTMLElement>('resultPanel');
  const tabs = el<HTMLDivElement>('resultTabs');
  const status = el<HTMLSpanElement>('resultStatus');
  const editor = el<HTMLTextAreaElement>('textEditor');
  const stats = el<HTMLSpanElement>('textStats');
  const truncatedNotice = el<HTMLParagraphElement>('truncatedNotice');
  const revert = el<HTMLButtonElement>('revertButton');
  const done = successfulItems();

  if (done.length === 0 || state.activeId === null) {
    panel.hidden = true;
    main.classList.remove('has-result');
    editor.value = '';
    editor.dataset.exportTitle = t('ocrOutput');
    stats.textContent = t('emptyStats');
    truncatedNotice.hidden = true;
    return;
  }

  // Keep the active tab valid.
  if (state.activeId !== 'all' && !done.some((item) => item.id === state.activeId)) {
    state.activeId = done.length > 1 ? 'all' : done[0].id;
  }

  panel.hidden = false;
  main.classList.add('has-result');

  // Tabs only appear when they help: more than one result.
  const focused = document.activeElement as HTMLElement | null;
  const focusedTabId = focused?.classList.contains('result-tab') ? focused.dataset.id : undefined;
  tabs.hidden = done.length < 2;
  tabs.replaceChildren();
  if (done.length >= 2) {
    const makeTab = (id: string, label: string) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `result-tab${state.activeId === id ? ' active' : ''}`;
      tab.dataset.id = id;
      tab.textContent = label;
      tab.setAttribute('aria-pressed', String(state.activeId === id));
      tab.addEventListener('click', () => {
        state.activeId = id;
        renderResult();
      });
      tabs.appendChild(tab);
    };
    makeTab('all', t('allFiles'));
    done.forEach((item) => makeTab(item.id, item.name));

    // Rebuilding tabs destroys the focused node; keep keyboard position stable.
    if (focusedTabId) {
      const restored = Array.from(tabs.querySelectorAll<HTMLButtonElement>('.result-tab')).find(
        (tab) => tab.dataset.id === focusedTabId
      );
      restored?.focus();
    }
  }

  const active = state.items.find((i) => i.id === state.activeId) ?? null;
  status.hidden = false;
  status.textContent = t('done');
  status.className = 'status-pill ok';

  const text = currentText();
  if (editor.value !== text) editor.value = text;
  stats.textContent = describeStats(text);
  const truncated =
    state.activeId === 'all'
      ? hasTruncatedPages(done.map((item) => item.result))
      : active?.result
        ? hasTruncatedPages([active.result])
        : false;
  truncatedNotice.hidden = !truncated;
  revert.hidden =
    state.activeId === 'all' ? state.combinedEdit == null : active?.editedText == null;

  editor.dataset.exportTitle =
    state.activeId === 'all' ? t('ocrAllResults') : safeFileStem(active?.name ?? t('ocrOutput'));
}
