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

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** Inclusive end of calendar day for MongoDB date queries (vouchers stored at UTC midnight). */
export const endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const formatIsoDate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * Resolve financial year start on or before asOf.
 */
export const resolveFyStart = (company = {}, asOf = new Date()) => {
  const now = startOfDay(asOf);

  if (company?.financialYear?.startDate) {
    const fy = new Date(company.financialYear.startDate);
    if (!Number.isNaN(fy.getTime())) {
      let start = startOfDay(new Date(now.getFullYear(), fy.getMonth(), fy.getDate()));
      if (start > now) start.setFullYear(start.getFullYear() - 1);
      return start;
    }
  }

  if (company?.booksFrom && /^\d{4}-\d{2}-\d{2}$/.test(company.booksFrom)) {
    const [y, m, d] = company.booksFrom.split('-').map(Number);
    let start = startOfDay(new Date(now.getFullYear(), m - 1, d));
    if (start > now) start.setFullYear(start.getFullYear() - 1);
    return start;
  }

  const fySetting = company?.settings?.fiscalYearStart;
  if (fySetting) {
    const parsed = new Date(fySetting);
    if (!Number.isNaN(parsed.getTime())) {
      let start = startOfDay(new Date(now.getFullYear(), parsed.getMonth(), parsed.getDate()));
      if (start > now) start.setFullYear(start.getFullYear() - 1);
      return start;
    }
    const pieces = String(fySetting).split(/[-/]/).map((p) => Number(p.trim()));
    if (pieces.length >= 2 && pieces.every((n) => Number.isFinite(n))) {
      const [month, day] = pieces;
      let start = startOfDay(new Date(now.getFullYear(), month - 1, day));
      if (start > now) start.setFullYear(start.getFullYear() - 1);
      return start;
    }
  }

  let start = startOfDay(new Date(now.getFullYear(), 3, 1));
  if (start > now) start.setFullYear(start.getFullYear() - 1);
  return start;
};

const getCurrentFyQuarterStart = (fyStart, asOf) => {
  const now = startOfDay(asOf);
  let activeFyStart = startOfDay(
    new Date(now.getFullYear(), fyStart.getMonth(), fyStart.getDate())
  );
  if (activeFyStart > now) {
    activeFyStart = startOfDay(
      new Date(now.getFullYear() - 1, fyStart.getMonth(), fyStart.getDate())
    );
  }

  let monthsSince =
    (now.getFullYear() - activeFyStart.getFullYear()) * 12 +
    (now.getMonth() - activeFyStart.getMonth());
  if (now.getDate() < activeFyStart.getDate()) {
    monthsSince -= 1;
  }
  monthsSince = Math.max(0, monthsSince);

  const quarterIndex = Math.floor(monthsSince / 3);
  const quarterStart = new Date(activeFyStart);
  quarterStart.setMonth(quarterStart.getMonth() + quarterIndex * 3);
  return startOfDay(quarterStart);
};

/**
 * @param {string} periodKey
 * @param {object} company
 * @param {Date} [asOf]
 */
export const resolveReportPeriod = (periodKey, company = {}, asOf = new Date()) => {
  const key = REPORT_PERIOD_KEYS.includes(periodKey) ? periodKey : 'this_month';
  const now = startOfDay(asOf);
  const label = PERIOD_LABELS[key];
  let fromDate;
  let toDate;
  let asOfDate;

  switch (key) {
    case 'this_month':
      fromDate = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      toDate = endOfDay(now);
      asOfDate = endOfDay(now);
      break;
    case 'last_month': {
      fromDate = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const lastDay = startOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
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
      fromDate = startOfDay(new Date(currentFyStart));
      fromDate.setFullYear(fromDate.getFullYear() - 1);
      const lastFyDay = startOfDay(new Date(currentFyStart));
      lastFyDay.setDate(lastFyDay.getDate() - 1);
      toDate = endOfDay(lastFyDay);
      asOfDate = toDate;
      break;
    }
    default:
      fromDate = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
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
