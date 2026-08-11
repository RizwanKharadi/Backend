import {
  formatNumber,
  formatQuantity,
  formatCurrency,
  formatCurrencyAbs,
  formatAmount,
  formatCompactAmount,
  formatPercent,
  formatDate,
  formatDateShortYear,
  formatDayMonth,
  formatWeekday,
  formatTime,
  formatDateTime,
  monthLabel,
  toLocalDateString,
  parseLocalDateString,
} from '../formatters';
import {
  setFormattingLocale,
  registerLocaleFormatData,
  getLocaleFormatData,
} from '../localeFormatData';

describe('formatters', () => {
  afterEach(() => setFormattingLocale('en'));

  describe('formatNumber — Indian grouping', () => {
    it('groups the last three digits then pairs', () => {
      expect(formatNumber(1234567)).toBe('12,34,567');
      expect(formatNumber(100000)).toBe('1,00,000');
      expect(formatNumber(12345678901)).toBe('12,34,56,78,901');
    });

    it('leaves short numbers ungrouped', () => {
      expect(formatNumber(0)).toBe('0');
      expect(formatNumber(999)).toBe('999');
      expect(formatNumber(1000)).toBe('1,000');
    });

    it('honours fraction digit bounds', () => {
      expect(formatNumber(1234.5, { minimumFractionDigits: 2 })).toBe('1,234.50');
      expect(formatNumber(1234.567, { maximumFractionDigits: 2 })).toBe('1,234.57');
      expect(formatNumber(1234.0, { maximumFractionDigits: 2 })).toBe('1,234');
    });

    it('keeps the sign outside the digits', () => {
      expect(formatNumber(-1234567)).toBe('-12,34,567');
      expect(formatNumber(1234, { alwaysSign: true })).toBe('+1,234');
    });

    it('never renders a negative zero', () => {
      // A "-0" in a ledger column reads as a real credit entry.
      expect(formatNumber(-0.001, { maximumFractionDigits: 0 })).toBe('0');
      expect(formatNumber(-0)).toBe('0');
    });

    it('coerces junk to zero rather than printing NaN', () => {
      expect(formatNumber(null)).toBe('0');
      expect(formatNumber(undefined)).toBe('0');
      expect(formatNumber('not a number')).toBe('0');
      expect(formatNumber('1234.5')).toBe('1,234.5');
    });
  });

  describe('formatQuantity', () => {
    it('drops decimals for whole units', () => {
      expect(formatQuantity(12)).toBe('12');
      expect(formatQuantity(100000)).toBe('1,00,000');
    });

    it('keeps up to two decimals for fractional stock', () => {
      expect(formatQuantity(12.5)).toBe('12.5');
      expect(formatQuantity(12.345)).toBe('12.35');
    });
  });

  describe('formatCurrency', () => {
    it('always shows two decimals with the symbol', () => {
      expect(formatCurrency(50000)).toBe('₹50,000.00');
      expect(formatCurrency(0)).toBe('₹0.00');
    });

    it('puts the minus outside the symbol', () => {
      expect(formatCurrency(-1500)).toBe('-₹1,500.00');
    });

    it('strips the sign in the Abs variant', () => {
      expect(formatCurrencyAbs(-1500)).toBe('₹1,500.00');
    });

    it('falls back to the code for currencies with no symbol', () => {
      expect(formatCurrency(1500, 'AED')).toBe('AED1,500.00');
      expect(formatCurrency(1500, 'XYZ')).toBe('XYZ1,500.00');
    });

    it('does not convert the currency across locales', () => {
      // An amount that came from Tally as INR stays INR in every language.
      setFormattingLocale('ar');
      expect(formatCurrency(50000)).toContain('₹');
    });
  });

  describe('formatAmount', () => {
    it('groups without a symbol', () => {
      expect(formatAmount(1234567.891)).toBe('12,34,567.89');
      expect(formatAmount(1000)).toBe('1,000');
    });
  });

  describe('formatCompactAmount — Indian scale', () => {
    it('abbreviates in crore and lakh', () => {
      expect(formatCompactAmount(12400000)).toBe('₹1.24Cr');
      expect(formatCompactAmount(125000)).toBe('₹1.25L');
      expect(formatCompactAmount(1500)).toBe('₹1.5K');
      expect(formatCompactAmount(750)).toBe('₹750');
    });

    it('handles the boundaries', () => {
      expect(formatCompactAmount(100000)).toBe('₹1.00L');
      expect(formatCompactAmount(10000000)).toBe('₹1.00Cr');
      expect(formatCompactAmount(99999)).toBe('₹100.0K');
    });

    it('keeps the sign', () => {
      expect(formatCompactAmount(-125000)).toBe('-₹1.25L');
    });
  });

  describe('formatCompactAmount — western scale', () => {
    beforeEach(() => {
      registerLocaleFormatData('ar', {
        ...getLocaleFormatData('en'),
        tag: 'ar',
        grouping: 'western',
        compact: 'western',
        rtl: true,
      });
      setFormattingLocale('ar');
    });

    it('abbreviates in millions, not lakh', () => {
      expect(formatCompactAmount(12400000)).toBe('₹12.40M');
      expect(formatCompactAmount(125000)).toBe('₹125.0K');
    });

    it('groups in threes', () => {
      expect(formatNumber(1234567)).toBe('1,234,567');
    });
  });

  describe('formatPercent', () => {
    it('appends the sign', () => {
      expect(formatPercent(12.34)).toBe('12.3%');
      expect(formatPercent(-5)).toBe('-5%');
    });
  });

  describe('dates', () => {
    const d = new Date(2026, 7, 7, 14, 5); // 7 Aug 2026, 14:05 local

    it('formats the standard shapes', () => {
      expect(formatDate(d)).toBe('07 Aug 2026');
      expect(formatDateShortYear(d)).toBe('07 Aug 26');
      expect(formatDayMonth(d)).toBe('7 Aug');
      expect(formatWeekday(d)).toBe('Fri');
      expect(formatTime(d)).toBe('14:05');
      expect(formatDateTime(d)).toBe('07 Aug 2026, 14:05');
    });

    it('returns empty rather than "Invalid Date"', () => {
      expect(formatDate('nonsense')).toBe('');
      expect(formatTime('nonsense')).toBe('');
      expect(formatWeekday('nonsense')).toBe('');
    });

    it('wraps month indices safely', () => {
      expect(monthLabel(0)).toBe('Jan');
      expect(monthLabel(11)).toBe('Dec');
      expect(monthLabel(12)).toBe('Jan');
      expect(monthLabel(-1)).toBe('Dec');
    });

    it('round-trips a local calendar date without a timezone shift', () => {
      const iso = toLocalDateString(new Date(2026, 0, 1));
      expect(iso).toBe('2026-01-01');
      const back = parseLocalDateString(iso);
      expect(back.getFullYear()).toBe(2026);
      expect(back.getMonth()).toBe(0);
      expect(back.getDate()).toBe(1);
    });
  });
});
