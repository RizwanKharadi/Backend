/**
 * Deterministic per-locale formatting tables.
 *
 * We do NOT use Intl here. Hermes on Android ships without full Intl support —
 * `toLocaleDateString(undefined, { weekday: 'short' })` yields the string
 * "undefined" rather than a weekday, and number formatting varies by engine.
 * For an accounting app that must reconcile against Tally, formatting has to be
 * identical on every device, so the tables below are the single source of truth.
 *
 * Digits are always Latin ('1234'), never Devanagari or Arabic-Indic. Users read
 * these figures side by side with a Tally screen; mixed numeral systems invite
 * transcription errors.
 */

/** How digits are grouped: Indian 12,34,567 vs western 1,234,567. */
export type GroupingStyle = 'indian' | 'western';

/** Which abbreviations the compact form uses for large amounts. */
export type CompactStyle = 'indian' | 'western';

export interface LocaleFormatData {
  /** BCP-47 tag. */
  tag: string;
  grouping: GroupingStyle;
  groupSeparator: string;
  decimalSeparator: string;
  compact: CompactStyle;
  /** Short month names, January first. */
  months: string[];
  /** Full month names, January first. */
  monthsLong: string[];
  /** Short weekday names, Sunday first. */
  weekdays: string[];
  /** Suffixes for the compact form, largest first. */
  compactSuffixes: { crore: string; lakh: string; thousand: string; million: string; billion: string };
  /** Right-to-left script. */
  rtl: boolean;
}

const EN: LocaleFormatData = {
  tag: 'en',
  grouping: 'indian',
  groupSeparator: ',',
  decimalSeparator: '.',
  compact: 'indian',
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  monthsLong: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  compactSuffixes: { crore: 'Cr', lakh: 'L', thousand: 'K', million: 'M', billion: 'B' },
  rtl: false,
};

/**
 * Locales are registered as they gain translations. Until a language ships its
 * own table it falls back to EN, which keeps figures correct (never localised
 * into a wrong grouping) while the UI strings are still being translated.
 */
const REGISTRY: Record<string, LocaleFormatData> = {
  en: EN,
};

export function registerLocaleFormatData(tag: string, data: LocaleFormatData): void {
  REGISTRY[tag] = data;
}

export function getLocaleFormatData(tag: string): LocaleFormatData {
  if (REGISTRY[tag]) return REGISTRY[tag];
  // 'hi-IN' → 'hi' before giving up.
  const base = tag.split('-')[0];
  return REGISTRY[base] || EN;
}

let activeTag = 'en';

/**
 * Set by the i18n layer whenever the user changes language. Formatters read this
 * rather than taking a locale argument at every call site, so a language switch
 * re-renders every figure without touching 200-odd components.
 */
export function setFormattingLocale(tag: string): void {
  activeTag = tag;
}

export function getFormattingLocale(): string {
  return activeTag;
}

export function activeLocaleData(): LocaleFormatData {
  return getLocaleFormatData(activeTag);
}
