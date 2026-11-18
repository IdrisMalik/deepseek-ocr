/** Browser-local storage for the user-supplied API key. */
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
    // Storage unavailable; the in-memory key still works for this session.
  }
}

export function clearKey(): void {
  try {
    localStorage.removeItem(clientConfig.keyStorageName);
  } catch {
    // Storage unavailable; clearing the in-memory key is handled separately.
  }
}
