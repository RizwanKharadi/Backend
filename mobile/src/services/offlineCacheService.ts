import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Voucher, InventoryItem } from '../types';

const PREFIX = '@finsync_offline_cache/';

export interface CachedVoucherStats {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  totalAmount: number;
  thisMonth: number;
  purchasesThisMonth?: number;
  salesThisMonth?: number;
  lastMonth: number;
}

export interface CachedDashboardExtras {
  recentVouchers: Voucher[];
  todayVouchers: Voucher[];
  trendVouchers?: Voucher[];
  receivablesTotal: number;
  receivableParties: number;
  overdueParties: number;
  bankBalance?: number;
  profitThisMonth?: number;
  topCustomerName?: string | null;
  topCustomerAmount?: number;
  monthlyRevenue?: number;
  cachedAt: string;
}

export interface CachedDayBook {
  entries: unknown[];
  summary: unknown;
  fromDate: string;
  toDate: string;
  cachedAt: string;
}

function key(companyId: string, suffix: string) {
  return `${PREFIX}${companyId}/${suffix}`;
}

export const offlineCacheService = {
  async saveVouchers(companyId: string, vouchers: Voucher[]): Promise<void> {
    if (!companyId) return;
    await AsyncStorage.setItem(
      key(companyId, 'vouchers'),
      JSON.stringify({ data: vouchers, cachedAt: new Date().toISOString() })
    );
  },

  async loadVouchers(companyId: string): Promise<Voucher[] | null> {
    if (!companyId) return null;
    const raw = await AsyncStorage.getItem(key(companyId, 'vouchers'));
    if (!raw) return null;
    try {
      return JSON.parse(raw).data as Voucher[];
    } catch {
      return null;
    }
  },

  async saveVoucherStats(companyId: string, stats: CachedVoucherStats): Promise<void> {
    if (!companyId) return;
    await AsyncStorage.setItem(
      key(companyId, 'voucher_stats'),
      JSON.stringify({ data: stats, cachedAt: new Date().toISOString() })
    );
  },

  async loadVoucherStats(companyId: string): Promise<CachedVoucherStats | null> {
    if (!companyId) return null;
    const raw = await AsyncStorage.getItem(key(companyId, 'voucher_stats'));
    if (!raw) return null;
    try {
      return JSON.parse(raw).data as CachedVoucherStats;
    } catch {
      return null;
    }
  },

  async saveInventoryItems(companyId: string, items: InventoryItem[]): Promise<void> {
    if (!companyId) return;
    await AsyncStorage.setItem(
      key(companyId, 'inventory'),
      JSON.stringify({ data: items, cachedAt: new Date().toISOString() })
    );
  },

  async loadInventoryItems(companyId: string): Promise<InventoryItem[] | null> {
    if (!companyId) return null;
    const raw = await AsyncStorage.getItem(key(companyId, 'inventory'));
    if (!raw) return null;
    try {
      return JSON.parse(raw).data as InventoryItem[];
    } catch {
      return null;
    }
  },

  async saveInventoryStats(companyId: string, stats: unknown): Promise<void> {
    if (!companyId) return;
    await AsyncStorage.setItem(
      key(companyId, 'inventory_stats'),
      JSON.stringify({ data: stats, cachedAt: new Date().toISOString() })
    );
  },

  async loadInventoryStats(companyId: string): Promise<unknown | null> {
    if (!companyId) return null;
    const raw = await AsyncStorage.getItem(key(companyId, 'inventory_stats'));
    if (!raw) return null;
    try {
      return JSON.parse(raw).data;
    } catch {
      return null;
    }
  },

  async saveDashboardExtras(companyId: string, extras: CachedDashboardExtras): Promise<void> {
    if (!companyId) return;
    await AsyncStorage.setItem(key(companyId, 'dashboard_extras'), JSON.stringify(extras));
  },

  async loadDashboardExtras(companyId: string): Promise<CachedDashboardExtras | null> {
    if (!companyId) return null;
    const raw = await AsyncStorage.getItem(key(companyId, 'dashboard_extras'));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedDashboardExtras;
    } catch {
      return null;
    }
  },

  async saveDashboardSummary<T>(companyId: string, summary: T): Promise<void> {
    if (!companyId) return;
    await AsyncStorage.setItem(
      key(companyId, 'dashboard_summary'),
      JSON.stringify({ summary, cachedAt: new Date().toISOString() })
    );
  },

  async loadDashboardSummary<T>(companyId: string): Promise<T | null> {
    if (!companyId) return null;
    const raw = await AsyncStorage.getItem(key(companyId, 'dashboard_summary'));
    if (!raw) return null;
    try {
      return (JSON.parse(raw) as { summary: T }).summary ?? null;
    } catch {
      return null;
    }
  },

  async saveDayBook(
    companyId: string,
    fromDate: string,
    toDate: string,
    entries: unknown[],
    summary: unknown
  ): Promise<void> {
    if (!companyId) return;
    await AsyncStorage.setItem(
      key(companyId, `daybook_${fromDate}_${toDate}`),
      JSON.stringify({
        entries,
        summary,
        fromDate,
        toDate,
        cachedAt: new Date().toISOString(),
      } satisfies CachedDayBook)
    );
  },

  async loadDayBook(
    companyId: string,
    fromDate: string,
    toDate: string
  ): Promise<CachedDayBook | null> {
    if (!companyId) return null;
    const raw = await AsyncStorage.getItem(key(companyId, `daybook_${fromDate}_${toDate}`));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedDayBook;
    } catch {
      return null;
    }
  },

  async getLastCacheTime(companyId: string): Promise<string | null> {
    const raw = await AsyncStorage.getItem(key(companyId, 'voucher_stats'));
    if (!raw) return null;
    try {
      return JSON.parse(raw).cachedAt as string;
    } catch {
      return null;
    }
  },
};
