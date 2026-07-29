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

export function formatDate(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

export function formatTime(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatCurrency(
  amount: number | string,
  currency: string = 'INR'
): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  const value = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // Fallback if Intl currency/locale isn't available on some devices
    return `${currency} ${value.toFixed(2)}`;
  }
}

/** INR display without minus (Tally often stores sales/payment as negative). */
export function formatCurrencyAbs(
  amount: number | string,
  currency: string = 'INR'
): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  const value = Number.isFinite(n) ? Math.abs(n) : 0;
  return formatCurrency(value, currency);
}

/** Compact INR for dashboard hero (e.g. ₹12.4L, ₹1.2Cr). */
export function formatIndianCompact(amount: number | string): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  const value = Number.isFinite(n) ? Math.abs(n) : 0;
  const sign = Number(amount) < 0 ? '-' : '';
  if (value >= 1_00_00_000) {
    return `${sign}₹${(value / 1_00_00_000).toFixed(2)}Cr`;
  }
  if (value >= 1_00_000) {
    return `${sign}₹${(value / 1_00_000).toFixed(2)}L`;
  }
  if (value >= 1_000) {
    return `${sign}₹${(value / 1_000).toFixed(1)}K`;
  }
  return `${sign}₹${value.toFixed(0)}`;
}

export function formatRelativeTime(timestamp: string | null | undefined): string {
  if (!timestamp) return 'Never';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Never';
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function getGreeting(name?: string): string {
  const hour = new Date().getHours();
  const base =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${base}, ${name.split(' ')[0]}` : base;
}

export function calcPercentChange(current: number, previous: number): number | null {
  if (!previous || previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

