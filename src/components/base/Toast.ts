/** Transient notifications, announced through a polite live region. */
export type ToastKind = 'info' | 'error';

export function toast(message: string, kind: ToastKind = 'info'): void {
  const region = document.getElementById('toastRegion');
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast${kind === 'error' ? ' error' : ''}`;
  node.textContent = message;
  region.replaceChildren(node);
  window.setTimeout(() => node.remove(), 4500);
}
