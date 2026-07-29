/**
 * Date-range helpers for the Transactions screen period filter
 * (Today / This Week / This Month / Custom) and growth comparisons.
 */
import { parseLocalDateString, toLocalDateString } from './formatters';

export type PeriodKey = 'today' | 'week' | 'month' | 'custom';

export interface DateRange {
  fromDate: string; // YYYY-MM-DD inclusive
  toDate: string; // YYYY-MM-DD inclusive
}

/** Monday-based start of the week containing `d`. */
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const dayFromMonday = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dayFromMonday);
  return x;
}

/** Resolve a period key (+ optional custom range) to concrete dates. */
export function rangeFor(period: PeriodKey, custom?: DateRange): DateRange {
  const now = new Date();
  const today = toLocalDateString(now);
  switch (period) {
    case 'today':
      return { fromDate: today, toDate: today };
    case 'week':
      return { fromDate: toLocalDateString(startOfWeek(now)), toDate: today };
    case 'month':
      return {
        fromDate: toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1)),
        toDate: today,
      };
    case 'custom':
    default:
      return custom ?? { fromDate: today, toDate: today };
  }
}

/** The equal-length period immediately preceding `range` (for growth %). */
export function previousRange(range: DateRange): DateRange {
  const from = parseLocalDateString(range.fromDate);
  const to = parseLocalDateString(range.toDate);
  const lenDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;

  const prevTo = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (lenDays - 1));

  return { fromDate: toLocalDateString(prevFrom), toDate: toLocalDateString(prevTo) };
}

/** Ordered list of YYYY-MM-DD days in the range (capped for safety). */
export function daysList(range: DateRange, cap = 120): string[] {
  const out: string[] = [];
  let d = parseLocalDateString(range.fromDate);
  const end = parseLocalDateString(range.toDate);
  let guard = 0;
  while (d.getTime() <= end.getTime() && guard < cap) {
    out.push(toLocalDateString(d));
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    d = next;
    guard += 1;
  }
  return out;
}

export function rangeLabel(period: PeriodKey, range: DateRange): string {
  switch (period) {
    case 'today':
      return `Today · ${range.fromDate}`;
    case 'week':
      return `This week · ${range.fromDate} to today`;
    case 'month':
      return `This month · ${range.fromDate} to today`;
    case 'custom':
    default:
      return `${range.fromDate} to ${range.toDate}`;
  }
}

export function vsLabel(period: PeriodKey): string {
  switch (period) {
    case 'today':
      return 'vs yesterday';
    case 'week':
      return 'vs last week';
    case 'month':
      return 'vs last month';
    case 'custom':
    default:
      return 'vs prev period';
  }
}

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'custom', label: 'Custom' },
];
