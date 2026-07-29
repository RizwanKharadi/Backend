export type ReportPeriodKey =
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'this_year'
  | 'last_year';

export const REPORT_PERIOD_OPTIONS: { key: ReportPeriodKey; label: string }[] = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'this_quarter', label: 'This Quarter' },
  { key: 'this_year', label: 'This Year' },
  { key: 'last_year', label: 'Last Year' },
];

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function resolvePeriodDates(periodKey: ReportPeriodKey): {
  startDate: string;
  endDate: string;
} {
  const now = new Date();
  let start: Date;
  let end: Date;

  switch (periodKey) {
    case 'last_month':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
      break;
    case 'this_quarter': {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), q * 3, 1);
      end = now;
      break;
    }
    case 'this_year':
      start = new Date(now.getFullYear(), 0, 1);
      end = now;
      break;
    case 'last_year':
      start = new Date(now.getFullYear() - 1, 0, 1);
      end = new Date(now.getFullYear() - 1, 11, 31);
      break;
    case 'this_month':
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = now;
  }

  return { startDate: fmt(start), endDate: fmt(end) };
}
