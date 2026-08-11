/**
 * The single source of truth for every number, amount and date the app renders.
 *
 * Nothing here calls Intl or `toLocaleString`. Hermes on Android ships without
 * full Intl, so those produce different output — sometimes the literal string
 * "undefined" — depending on the device. Figures in this app are reconciled
 * against Tally by hand, so they must render identically everywhere.
 *
 * Call these instead of formatting inline. `setFormattingLocale()` (see
 * localeFormatData.ts) switches the whole app's figures when the user changes
 * language; inline formatting silently opts out of that.
 */
import { activeLocaleData, getLocaleFormatData } from './localeFormatData';

/**
 * Locale that printed documents are pinned to. Invoices carry Indian grouping
 * and Latin digits whatever language the app is showing.
 */
export const DOCUMENT_LOCALE = 'en';

/**
 * Calendar date as YYYY-MM-DD in local timezone.
 * Do not use toISOString().split('T')[0] — that shifts dates backward in IST.
 */
export function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as local midnight (not UTC). */
export function parseLocalDateString(ymd: string): Date {
  const match = String(ymd).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return new Date(ymd);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toDate(input: string | number | Date): Date {
  return input instanceof Date ? input : new Date(input);
}

function isValid(d: Date): boolean {
  return !Number.isNaN(d.getTime());
}

function toFiniteNumber(value: number | string | null | undefined): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** Insert group separators into a run of digits, per the locale's style. */
function groupDigits(digits: string, style: 'indian' | 'western', sep: string): string {
  if (digits.length <= 3) return digits;
  if (style === 'western') {
    let out = '';
    for (let i = digits.length; i > 0; i -= 3) {
      const start = Math.max(0, i - 3);
      out = digits.slice(start, i) + (out ? sep + out : '');
    }
    return out;
  }
  // Indian: last three digits, then groups of two — 1,23,45,678.
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return parts.join(sep) + sep + last3;
}

export interface NumberFormatOptions {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  /** Render the sign even when positive. */
  alwaysSign?: boolean;
  /**
   * Pin the output to one locale instead of following the user's language.
   * Used for printed invoices and other statutory documents, whose layout is a
   * property of the document — not of whatever language the app happens to be
   * displaying.
   */
  locale?: string;
}

/** Grouped decimal number with no currency symbol. */
export function formatNumber(
  value: number | string | null | undefined,
  options: NumberFormatOptions = {}
): string {
  const {
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
    alwaysSign = false,
    locale: pinned,
  } = options;
  const locale = pinned ? getLocaleFormatData(pinned) : activeLocaleData();
  const n = toFiniteNumber(value);

  const maxFd = Math.max(minimumFractionDigits, maximumFractionDigits);
  const fixed = Math.abs(n).toFixed(maxFd);
  let [intPart, fracPart = ''] = fixed.split('.');

  // Trim trailing zeros down to the minimum requested.
  while (fracPart.length > minimumFractionDigits && fracPart.endsWith('0')) {
    fracPart = fracPart.slice(0, -1);
  }

  const grouped = groupDigits(intPart, locale.grouping, locale.groupSeparator);
  const body = fracPart ? grouped + locale.decimalSeparator + fracPart : grouped;

  // `n < 0` after rounding can still be true for -0.001 at 0 decimals; suppress
  // a bare "-0" because a negative zero in a ledger reads as a real credit.
  const isNegative = n < 0 && Number(fixed) !== 0;
  if (isNegative) return '-' + body;
  return alwaysSign ? '+' + body : body;
}

/**
 * Quantities: whole numbers show no decimals, fractional ones show up to two.
 * Stock is often held in whole units and "12.00 pcs" reads as false precision.
 */
export function formatQuantity(value: number | string | null | undefined): string {
  const n = toFiniteNumber(value);
  return Number.isInteger(n)
    ? formatNumber(n, { maximumFractionDigits: 0 })
    : formatNumber(n, { maximumFractionDigits: 2 });
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  AED: 'AED',
  SAR: 'SAR',
  QAR: 'QAR',
  OMR: 'OMR',
  BHD: 'BHD',
  KWD: 'KWD',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export function currencySymbol(currency: string = 'INR'): string {
  return CURRENCY_SYMBOLS[currency] || currency;
}

/**
 * An amount with its currency symbol.
 *
 * The currency itself is never localised — an amount that came from Tally as
 * ₹50,000 stays ₹50,000 in every language. Only grouping and separators change.
 */
export function formatCurrency(
  amount: number | string | null | undefined,
  currency: string = 'INR'
): string {
  const symbol = currencySymbol(currency);
  const n = toFiniteNumber(amount);
  const body = formatNumber(Math.abs(n), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // Sign goes outside the symbol: -₹500, not ₹-500.
  const sign = n < 0 ? '-' : '';
  return `${sign}${symbol}${body}`;
}

/** Amount rounded to whole units, for dense lists where paise are noise. */
export function formatCurrencyWhole(
  amount: number | string | null | undefined,
  currency: string = 'INR'
): string {
  const n = toFiniteNumber(amount);
  const body = formatNumber(Math.abs(n), { maximumFractionDigits: 0 });
  return `${n < 0 ? '-' : ''}${currencySymbol(currency)}${body}`;
}

/** Amount display without a minus (Tally stores sales/payment as negative). */
export function formatCurrencyAbs(
  amount: number | string | null | undefined,
  currency: string = 'INR'
): string {
  return formatCurrency(Math.abs(toFiniteNumber(amount)), currency);
}

/** Grouped amount with no symbol, for rows that print the symbol separately. */
export function formatAmount(amount: number | string | null | undefined): string {
  return formatNumber(amount, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * Compact amount for dashboard tiles — ₹12.40Cr, ₹1.25L.
 *
 * Indian locales abbreviate in crore/lakh; Arabic and other western-grouped
 * locales have no such units, so they get M/K instead. The thresholds differ
 * with the scale, which is why this is not just a suffix lookup.
 */
export function formatCompactAmount(
  amount: number | string | null | undefined,
  currency: string = 'INR'
): string {
  const locale = activeLocaleData();
  const raw = toFiniteNumber(amount);
  const value = Math.abs(raw);
  const sign = raw < 0 ? '-' : '';
  const symbol = currencySymbol(currency);
  const s = locale.compactSuffixes;

  const scaled = (divisor: number, suffix: string, digits: number) =>
    `${sign}${symbol}${formatNumber(value / divisor, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}${suffix}`;

  if (locale.compact === 'indian') {
    if (value >= 1_00_00_000) return scaled(1_00_00_000, s.crore, 2);
    if (value >= 1_00_000) return scaled(1_00_000, s.lakh, 2);
    if (value >= 1_000) return scaled(1_000, s.thousand, 1);
  } else {
    if (value >= 1_000_000_000) return scaled(1_000_000_000, s.billion, 2);
    if (value >= 1_000_000) return scaled(1_000_000, s.million, 2);
    if (value >= 1_000) return scaled(1_000, s.thousand, 1);
  }
  return `${sign}${symbol}${formatNumber(value, { maximumFractionDigits: 0 })}`;
}

/** Compact form with no currency symbol, for counts and non-money stats. */
export function formatCompactNumber(value: number | string | null | undefined): string {
  const locale = activeLocaleData();
  const raw = toFiniteNumber(value);
  const abs = Math.abs(raw);
  const sign = raw < 0 ? '-' : '';
  const s = locale.compactSuffixes;

  const scaled = (divisor: number, suffix: string) =>
    `${sign}${formatNumber(abs / divisor, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}${suffix}`;

  if (locale.compact === 'indian') {
    if (abs >= 1_00_00_000) return scaled(1_00_00_000, s.crore);
    if (abs >= 1_00_000) return scaled(1_00_000, s.lakh);
  } else {
    if (abs >= 1_000_000_000) return scaled(1_000_000_000, s.billion);
    if (abs >= 1_000_000) return scaled(1_000_000, s.million);
  }
  if (abs >= 1_000) return scaled(1_000, s.thousand);
  return formatNumber(raw, { maximumFractionDigits: 0 });
}

export function formatPercent(
  value: number | string | null | undefined,
  options: NumberFormatOptions = {}
): string {
  return (
    formatNumber(value, { maximumFractionDigits: 1, ...options }) + '%'
  );
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** '07 Aug 2026' */
export function formatDate(input: string | number | Date): string {
  const d = toDate(input);
  if (!isValid(d)) return '';
  const locale = activeLocaleData();
  const day = String(d.getDate()).padStart(2, '0');
  return `${day} ${locale.months[d.getMonth()]} ${d.getFullYear()}`;
}

/** '7 August 2026' — for profile and detail screens with room to breathe. */
export function formatDateLong(input: string | number | Date): string {
  const d = toDate(input);
  if (!isValid(d)) return '';
  const locale = activeLocaleData();
  return `${d.getDate()} ${locale.monthsLong[d.getMonth()]} ${d.getFullYear()}`;
}

/** '07 Aug 26' — for chips and dense rows where the century is noise. */
export function formatDateShortYear(input: string | number | Date): string {
  const d = toDate(input);
  if (!isValid(d)) return '';
  const locale = activeLocaleData();
  const day = String(d.getDate()).padStart(2, '0');
  return `${day} ${locale.months[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

/** '6 Aug' — chart axes and day headers. */
export function formatDayMonth(input: string | number | Date): string {
  const d = toDate(input);
  if (!isValid(d)) return '';
  const locale = activeLocaleData();
  return `${d.getDate()} ${locale.months[d.getMonth()]}`;
}

/** 'Mon' */
export function formatWeekday(input: string | number | Date): string {
  const d = toDate(input);
  if (!isValid(d)) return '';
  return activeLocaleData().weekdays[d.getDay()];
}

/** 'Mon, 6 Aug' */
export function formatWeekdayDayMonth(input: string | number | Date): string {
  const d = toDate(input);
  if (!isValid(d)) return '';
  return `${formatWeekday(d)}, ${formatDayMonth(d)}`;
}

/** Short month name by index (0 = January). */
export function monthLabel(monthIndex: number): string {
  const locale = activeLocaleData();
  return locale.months[((monthIndex % 12) + 12) % 12];
}

/** All twelve short month names, January first. */
export function monthLabels(): string[] {
  return activeLocaleData().months;
}

/** '14:05' — 24-hour, which is unambiguous across every locale we ship. */
export function formatTime(input: string | number | Date): string {
  const d = toDate(input);
  if (!isValid(d)) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** '07 Aug 2026, 14:05' */
export function formatDateTime(input: string | number | Date): string {
  const d = toDate(input);
  if (!isValid(d)) return '';
  return `${formatDate(d)}, ${formatTime(d)}`;
}

/** Date and time pinned to DOCUMENT_LOCALE, for printed invoices. */
export function formatDocumentDateTime(input: string | number | Date): string {
  const d = toDate(input);
  if (!isValid(d)) return '';
  const locale = getLocaleFormatData(DOCUMENT_LOCALE);
  const day = String(d.getDate()).padStart(2, '0');
  return `${day} ${locale.months[d.getMonth()]} ${d.getFullYear()}, ${formatTime(d)}`;
}

// ---------------------------------------------------------------------------
// Strings that need translating
//
// These return English today. Step 2 of the i18n work injects the translator so
// they read from the active language; every caller already goes through here, so
// that switch happens in one place rather than at each call site.
// ---------------------------------------------------------------------------

type Translator = (key: string, params?: Record<string, unknown>) => string;

let translate: Translator = (key, params) => {
  // Identity fallback used before i18n initialises (and in unit tests).
  const fallbacks: Record<string, string> = {
    'time.never': 'Never',
    'time.justNow': 'Just now',
    'time.minutesAgo': `${params?.count}m ago`,
    'time.hoursAgo': `${params?.count}h ago`,
    'time.daysAgo': `${params?.count}d ago`,
    'greeting.morning': 'Good morning',
    'greeting.afternoon': 'Good afternoon',
    'greeting.evening': 'Good evening',
  };
  return fallbacks[key] ?? key;
};

/** Wired up by src/i18n once i18next has initialised. */
export function setFormatterTranslator(fn: Translator): void {
  translate = fn;
}

export function formatRelativeTime(timestamp: string | null | undefined): string {
  if (!timestamp) return translate('time.never');
  const date = new Date(timestamp);
  if (!isValid(date)) return translate('time.never');
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return translate('time.justNow');
  if (diffMins < 60) return translate('time.minutesAgo', { count: diffMins });
  if (diffHours < 24) return translate('time.hoursAgo', { count: diffHours });
  if (diffDays < 7) return translate('time.daysAgo', { count: diffDays });
  return formatDate(date);
}

export function getGreeting(name?: string): string {
  const hour = new Date().getHours();
  const key =
    hour < 12 ? 'greeting.morning' : hour < 17 ? 'greeting.afternoon' : 'greeting.evening';
  const base = translate(key);
  return name ? `${base}, ${name.split(' ')[0]}` : base;
}

export function calcPercentChange(current: number, previous: number): number | null {
  if (!previous || previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}
