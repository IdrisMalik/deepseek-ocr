/** Message lookup with `{name}` interpolation. */
import { en } from './en.js';

export type TranslationKey = keyof typeof en;
export type TranslationParams = Record<string, string | number>;

export const t = (key: TranslationKey, params: TranslationParams = {}): string =>
  en[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : placeholder;
  });
