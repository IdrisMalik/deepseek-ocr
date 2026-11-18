/**
 * Show/hide state for the API key field, kept separate from the app shell so
 * masking can be tested without a DOM. Changes only the input type and the
 * toggle's exposed state; never reads, writes or clears the key.
 */

type KeyInput = Pick<HTMLInputElement, 'type'>;

type KeyToggle = Pick<HTMLButtonElement, 'title'> & {
  setAttribute(name: string, value: string): void;
};

export type KeyVisibilityLabels = { show: string; hide: string };

/** Apply masked (`false`) or visible (`true`) state to the key field. */
export function setKeyVisibility(
  input: KeyInput,
  toggle: KeyToggle,
  visible: boolean,
  labels: KeyVisibilityLabels
): void {
  const label = visible ? labels.hide : labels.show;
  input.type = visible ? 'text' : 'password';
  toggle.setAttribute('aria-pressed', String(visible));
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
}
