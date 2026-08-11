/**
 * i18n bootstrap.
 *
 * Owns three things that must always move together when the language changes:
 *   1. i18next's active language (UI strings),
 *   2. the formatting locale (grouping, month names, compact suffixes),
 *   3. the translator that formatters.ts uses for its own few strings.
 *
 * Call `initI18n()` once at startup and `changeLanguage()` for every switch —
 * never `i18next.changeLanguage` directly, or the figures and the words drift
 * out of step.
 */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
  registerLocaleFormatData,
  setFormattingLocale,
  getLocaleFormatData,
  type LocaleFormatData,
} from '../utils/localeFormatData';
import { setFormatterTranslator } from '../utils/formatters';
import { LANGUAGES, DEFAULT_LANGUAGE, findLanguage, isAvailable } from './languages';
import { getDeviceLanguage } from './deviceLocale';
import { resources } from './resources';

/** Push each language's formatting overrides onto the English baseline. */
function registerFormatData(): void {
  const base = getLocaleFormatData('en');
  for (const lang of LANGUAGES) {
    registerLocaleFormatData(lang.code, {
      ...base,
      ...lang.format,
      tag: lang.code,
      rtl: lang.rtl,
    } as LocaleFormatData);
  }
}

/**
 * Resolve the language to start in: the user's saved choice, else the device
 * language if we ship it, else English.
 */
export function resolveInitialLanguage(saved?: string | null): string {
  const candidates = [saved, getDeviceLanguage()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const lang = findLanguage(candidate);
    if (lang && isAvailable(lang.code)) return lang.code;
  }
  return DEFAULT_LANGUAGE;
}

let initialised = false;

export async function initI18n(savedLanguage?: string | null): Promise<void> {
  registerFormatData();
  const lng = resolveInitialLanguage(savedLanguage);

  if (!initialised) {
    await i18next.use(initReactI18next).init({
      resources,
      lng,
      fallbackLng: DEFAULT_LANGUAGE,
      // A missing key shows the English string, not the raw key — a half
      // translated screen should still be readable.
      returnEmptyString: false,
      interpolation: {
        // React Native already escapes rendered text.
        escapeValue: false,
      },
      compatibilityJSON: 'v3',
    });
    initialised = true;
  }

  applyLanguage(lng);
}

/** Keep formatters in step with i18next. */
function applyLanguage(code: string): void {
  setFormattingLocale(code);
  setFormatterTranslator(
    (key, params) => String(i18next.t(key, params as never))
  );
}

/**
 * Switch language app-wide. Returns the code actually applied, which may differ
 * from the request if the language has no translation file yet.
 */
export async function changeLanguage(code: string): Promise<string> {
  const lang = findLanguage(code);
  const target = lang && isAvailable(lang.code) ? lang.code : DEFAULT_LANGUAGE;
  await i18next.changeLanguage(target);
  applyLanguage(target);
  return target;
}

/**
 * Translate from outside React — class components, module-level helpers, and
 * anything that can run before `initI18n()` has finished.
 *
 * The error boundary is the reason this exists: it wraps the whole app,
 * including the rehydration gate, so it can render before i18n is up. Showing a
 * raw key like "errors.boundary.title" to someone whose app has just crashed
 * would be worse than showing English.
 */
export function tSafe(key: string, fallback: string, params?: Record<string, unknown>): string {
  if (!initialised || !i18next.isInitialized) return fallback;
  const value = i18next.t(key, { defaultValue: fallback, ...params } as never);
  return typeof value === 'string' ? value : fallback;
}

export { i18next };
