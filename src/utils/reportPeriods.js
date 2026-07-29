export const REPORT_PERIOD_KEYS = [
  'this_month',
  'last_month',
  'this_quarter',
  'this_year',
  'last_year'
];

/** Fast path: only refresh the period users see by default on routine syncs */
export const INCREMENTAL_REPORT_PERIOD_KEYS = ['this_month'];

export const PERIOD_LABELS = {
  this_month: 'This Month',
  last_month: 'Last Month',
  this_quarter: 'This Quarter',
  this_year: 'This Year',
  last_year: 'Last Year'
};

export const LABEL_TO_PERIOD_KEY = Object.fromEntries(
  Object.entries(PERIOD_LABELS).map(([key, label]) => [label, key])
);

/**
 * All report boundaries are calendar dates in the business timezone (IST by default).
 * Voucher dates sync from Tally as day-granular values stored at UTC midnight of the
 * calendar date, so boundary Date objects are built with Date.UTC from IST calendar
 * parts — NOT from server-local time (Railway runs UTC; local "today" lags IST by 5.5h).
 */
export const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || 'Asia/Kolkata';

const tzDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: REPORT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** Current calendar date in the report timezone as {y, m, d} (m is 1-based). */
export const currentTzDateParts = (date = new Date()) => {
  const [y, m, d] = tzDayFormatter.format(date).split('-').map(Number);
  return { y, m, d };
};

/** UTC midnight for a calendar date — matches voucher date storage. */
const utcDate = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

const utcDateEnd = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));

/** Normalize an arbitrary Date/parseable value to UTC midnight of its calendar date. */
const startOfDay = (value) => {
  const x = value instanceof Date ? value : new Date(value);
  return utcDate(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
};

/** Inclusive end of calendar day for MongoDB date queries (vouchers stored at UTC midnight). */
export const endOfDay = (value) => {
  const x = value instanceof Date ? value : new Date(value);
  return utcDateEnd(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
};

/** "Today" in the report timezone, as a UTC-midnight Date (storage-aligned). */
export const todayInReportTz = (asOf = new Date()) => {
  const { y, m, d } = currentTzDateParts(asOf);
  return utcDate(y, m, d);
};

const formatIsoDate = (d) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * Anchor "now" for period math. Accepts a plain Date (uses its IST calendar date) so
 * existing call sites passing `new Date()` keep working.
 */
const resolveNow = (asOf) => {
  if (!asOf) return todayInReportTz();
  const x = asOf instanceof Date ? asOf : new Date(asOf);
  if (Number.isNaN(x.getTime())) return todayInReportTz();
  const msIntoUtcDay = ((x.getTime() % 86400000) + 86400000) % 86400000;
  // UTC midnight / UTC end-of-day → already a storage-aligned calendar boundary; keep as-is.
  if (msIntoUtcDay === 0 || msIntoUtcDay === 86399999) return startOfDay(x);
  // Real wall-clock timestamp → resolve its calendar date in the report timezone.
  return todayInReportTz(x);
};

/**
 * Resolve financial year start on or before asOf.
 */
export const resolveFyStart = (company = {}, asOf = new Date()) => {
  const now = resolveNow(asOf);

  const fyFromMonthDay = (monthIndex0, dayOfMonth) => {
    let start = utcDate(now.getUTCFullYear(), monthIndex0 + 1, dayOfMonth);
    if (start > now) start = utcDate(now.getUTCFullYear() - 1, monthIndex0 + 1, dayOfMonth);
    return start;
  };

  if (company?.financialYear?.startDate) {
    const fy = new Date(company.financialYear.startDate);
    if (!Number.isNaN(fy.getTime())) {
      return fyFromMonthDay(fy.getUTCMonth(), fy.getUTCDate());
    }
  }

  if (company?.booksFrom && /^\d{4}-\d{2}-\d{2}$/.test(company.booksFrom)) {
    const [, m, d] = company.booksFrom.split('-').map(Number);
    return fyFromMonthDay(m - 1, d);
  }

  const fySetting = company?.settings?.fiscalYearStart;
  if (fySetting) {
    const parsed = new Date(fySetting);
    if (!Number.isNaN(parsed.getTime())) {
      return fyFromMonthDay(parsed.getUTCMonth(), parsed.getUTCDate());
    }
    const pieces = String(fySetting).split(/[-/]/).map((p) => Number(p.trim()));
    if (pieces.length >= 2 && pieces.every((n) => Number.isFinite(n))) {
      const [month, day] = pieces;
      return fyFromMonthDay(month - 1, day);
    }
  }

  // Default: Indian financial year starting 1 April.
  return fyFromMonthDay(3, 1);
};

const getCurrentFyQuarterStart = (fyStart, asOf) => {
  const now = resolveNow(asOf);
  let activeFyStart = utcDate(
    now.getUTCFullYear(),
    fyStart.getUTCMonth() + 1,
    fyStart.getUTCDate()
  );
  if (activeFyStart > now) {
    activeFyStart = utcDate(
      now.getUTCFullYear() - 1,
      fyStart.getUTCMonth() + 1,
      fyStart.getUTCDate()
    );
  }

  let monthsSince =
    (now.getUTCFullYear() - activeFyStart.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - activeFyStart.getUTCMonth());
  if (now.getUTCDate() < activeFyStart.getUTCDate()) {
    monthsSince -= 1;
  }
  monthsSince = Math.max(0, monthsSince);

  const quarterIndex = Math.floor(monthsSince / 3);
  const quarterStart = new Date(activeFyStart);
  quarterStart.setUTCMonth(quarterStart.getUTCMonth() + quarterIndex * 3);
  return startOfDay(quarterStart);
};

/**
 * @param {string} periodKey
 * @param {object} company
 * @param {Date} [asOf]
 */
export const resolveReportPeriod = (periodKey, company = {}, asOf = new Date()) => {
  const key = REPORT_PERIOD_KEYS.includes(periodKey) ? periodKey : 'this_month';
  const now = resolveNow(asOf);
  const label = PERIOD_LABELS[key];
  let fromDate;
  let toDate;
  let asOfDate;

  switch (key) {
    case 'this_month':
      fromDate = utcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
      toDate = endOfDay(now);
      asOfDate = endOfDay(now);
      break;
    case 'last_month': {
      fromDate = utcDate(now.getUTCFullYear(), now.getUTCMonth(), 1);
      const lastDay = utcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, 0);
      toDate = endOfDay(lastDay);
      asOfDate = toDate;
      break;
    }
    case 'this_quarter': {
      const fyStart = resolveFyStart(company, now);
      fromDate = getCurrentFyQuarterStart(fyStart, now);
      toDate = endOfDay(now);
      asOfDate = endOfDay(now);
      break;
    }
    case 'this_year': {
      fromDate = resolveFyStart(company, now);
      toDate = endOfDay(now);
      asOfDate = endOfDay(now);
      break;
    }
    case 'last_year': {
      const currentFyStart = resolveFyStart(company, now);
      fromDate = new Date(currentFyStart);
      fromDate.setUTCFullYear(fromDate.getUTCFullYear() - 1);
      const lastFyDay = new Date(currentFyStart);
      lastFyDay.setUTCDate(lastFyDay.getUTCDate() - 1);
      toDate = endOfDay(lastFyDay);
      asOfDate = toDate;
      break;
    }
    default:
      fromDate = utcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
      toDate = endOfDay(now);
      asOfDate = endOfDay(now);
  }

  return {
    periodKey: key,
    label,
    fromDate,
    toDate,
    asOfDate,
    fromDateIso: formatIsoDate(fromDate),
    toDateIso: formatIsoDate(toDate),
    asOfDateIso: formatIsoDate(asOfDate)
  };
};

export const normalizePeriodKey = (input) => {
  if (!input) return 'this_month';
  if (REPORT_PERIOD_KEYS.includes(input)) return input;
  return LABEL_TO_PERIOD_KEY[input] || 'this_month';
};

/**
 * Balance Sheet voucher drill-down: FY/books start through as-on date (inclusive).
 */
export const resolveBalanceSheetVoucherRange = (periodKey, company = {}, asOf = new Date()) => {
  const period = resolveReportPeriod(periodKey, company, asOf);
  const booksFrom = resolveFyStart(company, period.asOfDate);
  return {
    ...period,
    fromDate: booksFrom,
    toDate: period.toDate,
    booksFromDate: booksFrom,
    booksFromDateIso: formatIsoDate(booksFrom)
  };
};
