/** Browser-local settings: the user-supplied API key (BYOK). */
import { clientConfig } from '../utils/config.js';

export function loadKey(): string {
  try {
    return localStorage.getItem(clientConfig.keyStorageName) ?? '';
  } catch {
    return '';
  }
}

export function saveKey(key: string): void {
  try {
    localStorage.setItem(clientConfig.keyStorageName, key);
  } catch {
    // Storage unavailable — the key still works for the current page session.
  }
}

export function clearKey(): void {
  try {
    localStorage.removeItem(clientConfig.keyStorageName);
  } catch {
    // ignore
  }
}
