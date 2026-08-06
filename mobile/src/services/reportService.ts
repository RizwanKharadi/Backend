import { apiClient } from './apiClient';

export type ReportPeriodKey =
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'this_year'
  | 'last_year';

export interface ReportParams {
  companyId: string;
  periodKey?: ReportPeriodKey;
  startDate?: string;
  endDate?: string;
  dateFrom?: string;
  dateTo?: string;
  format?: 'json' | 'pdf' | 'excel' | 'csv';
  /** Bucket size for period-series reports (sales/purchase). Server default: day. */
  groupBy?: 'day' | 'week' | 'month';
  filters?: Record<string, any>;
}

export interface FinancialReport {
  revenue: number;
  expenses: number;
  profit: number;
  profitMargin: number;
  trends: Array<{
    period: string;
    revenue: number;
    expenses: number;
    profit: number;
  }>;
}

/**
 * Mirrors GET /api/reports/sales exactly. The previous shape here
 * (totalSales/salesByPeriod[].period/.sales) did not exist on the response, so
 * anything reading it silently got `undefined` and charted nothing.
 */
export interface SalesReport {
  period: { startDate: string; endDate: string };
  summary: {
    totalSales: number;
    totalQuantity: number;
    transactionCount: number;
    averageOrderValue: number;
  };
  salesByPeriod: Array<{
    date: string;
    amount: number;
    count: number;
  }>;
  topCustomers: Array<{
    name: string;
    totalAmount: number;
    transactionCount: number;
  }>;
}

export interface InventoryReport {
  totalItems: number;
  totalValue: number;
  lowStockItems: number;
  outOfStockItems: number;
  topMovingItems: Array<{
    id: string;
    name: string;
    quantity: number;
    value: number;
  }>;
  categoryBreakdown: Record<string, {
    items: number;
    value: number;
  }>;
}

export interface OutstandingLedgerSummary {
  partyName: string;
  totalOutstanding: number;
  billCount: number;
  oldestBillDue?: string;
  oldestOverdueDays?: number;
}

export interface OutstandingBill {
  billRef: string;
  billDate?: string;
  billDue?: string;
  billOverdue?: number;
  closingBalance: number;
  vchType?: string;
  vchNumber?: string;
  vchDate?: string;
  vchAmount?: number;
  voucherId?: string | null;
  inventoryLines?: Array<{ item?: string; quantity?: string; rate?: string }>;
}

/** Which Tally report to read — 'Bills Receivable' or 'Bills Payable'. */
export type OutstandingKind = 'receivable' | 'payable';

export interface OutstandingReceivableSummary {
  asOfDate?: string;
  fromDate?: string;
  toDate?: string;
  totalOutstanding: number;
  lastSyncedAt?: string;
  ledgers: OutstandingLedgerSummary[];
}

export interface OutstandingLedgerDetail {
  asOfDate?: string;
  partyName: string;
  totalOutstanding: number;
  billCount: number;
  oldestBillDue?: string;
  oldestOverdueDays?: number;
  bills: OutstandingBill[];
}

export interface TopTenRow {
  rank: number;
  name: string;
  totalAmount: number;
  quantity?: number;
  transactionCount?: number;
  sharePercent: number;
  partyId?: string;
  itemId?: string;
}

export interface TopTenReportData {
  period: { startDate: string; endDate: string };
  summary: {
    totalCustomerSales: number;
    totalSupplierPurchases: number;
    totalItemsSoldValue: number;
    totalItemsPurchasedValue: number;
    totalItemsSoldQty: number;
    totalItemsPurchasedQty: number;
  };
  topCustomers: TopTenRow[];
  topSuppliers: TopTenRow[];
  itemsSoldByValue: TopTenRow[];
  itemsPurchasedByValue: TopTenRow[];
  itemsSoldByQty: TopTenRow[];
  itemsPurchasedByQty: TopTenRow[];
}

export type TopTenCategory =
  | 'customers'
  | 'suppliers'
  | 'items_sold_value'
  | 'items_purchased_value'
  | 'items_sold_qty'
  | 'items_purchased_qty';

export interface InactiveCustomerRow {
  name: string;
  lastSaleDate: string | null;
  lastSaleDateDisplay?: string | null;
  billCount: number;
}

export interface InactiveItemRow {
  name: string;
  quantity: number;
  unit: string;
  amount: number;
  lastSaleDate: string | null;
  lastSaleDateDisplay?: string | null;
  billCount: number;
}

export interface FastMovingItemRow {
  rank: number;
  itemId: string | null;
  name: string;
  unit: string;
  qtySold: number;
  totalAmount: number;
}

export interface FastMovingItemsData {
  period: {
    periodKey: ReportPeriodKey;
    label: string;
    startDate: string;
    endDate: string;
  };
  summary: { totalQtySold: number };
  items: FastMovingItemRow[];
}

export interface ProfitLossGroup {
  name: string;
  amount: number;
  side: 'revenue' | 'expense';
  drillable: boolean;
  ledgerCount?: number;
}

export interface BalanceSheetGroup {
  name: string;
  amount: number;
  section: 'assets' | 'liabilities' | 'equity';
  drillable: boolean;
  ledgerCount?: number;
}

export type FinancialReportKind = 'profit_loss' | 'balance_sheet';

export interface ProfitLossGroupLedger {
  name: string;
  displayName: string;
  debit: number;
  credit: number;
  amount: number;
  /** Tally subgroup (bold in Group Summary) — drill to nested group, not vouchers */
  isGroup?: boolean;
}

export interface ProfitLossVoucherRow {
  id: string;
  voucherNumber: string;
  voucherType: string;
  date: string;
  dateDisplay?: string;
  partyName: string;
  amount: number;
  narration?: string;
}

export interface CashBankBookSection {
  name: string;
  parentGroup: string;
  debit: number;
  credit: number;
  ledgerCount: number;
  drillable: boolean;
}

export interface CashBankBookSummary {
  reportName: string;
  period: {
    periodKey: string;
    label: string;
    startDate: string;
    endDate: string;
    asOfDate: string;
  };
  lastSyncDate?: string | null;
  sections: CashBankBookSection[];
}

export interface CashBankBookLedgersData {
  parentGroup: string;
  debit: number;
  credit: number;
  ledgers: ProfitLossGroupLedger[];
}

export interface InactiveCustomersData {
  filter: { mode: string; days: number | null; label: string };
  summary: {
    inactiveCount: number;
    totalCustomers: number;
    percentOfTotal: number;
  };
  customers: InactiveCustomerRow[];
}

export interface InactiveItemsData {
  filter: { mode: string; days: number | null; label: string };
  summary: {
    inactiveCount: number;
    totalItems: number;
    percentOfTotal: number;
    totalValue: number;
  };
  items: InactiveItemRow[];
}

export interface DashboardSummaryData {
  asOf?: { date: string; timezone: string };
  lastSyncedAt?: string | null;
  todaySales: { amount: number; count: number };
  monthlyRevenue: { amount: number; count: number; fromDate: string; toDate: string };
  monthlyPurchase?: { amount: number; count: number; fromDate: string; toDate: string };
  outstanding: { receivables: number; overdueParties: number; parties: number };
  payable?: {
    payables: number;
    overdueParties: number;
    parties: number;
    synced: boolean;
  };
  bankBalance: { amount: number; bankAccounts: number; cashInHand: number };
  profitThisMonth: number;
  topCustomer: { name: string; amount: number } | null;
  salesTrend: Array<{ date: string; amount: number; count: number }>;
  /** Back-compat block older backends send; used as a purchase fallback. */
  thisMonth?: { sales: number; purchases: number; profit: number };
  recentVouchers: Array<{
    id: string;
    voucherNumber: string;
    voucherType: string;
    tallyVoucherTypeParent?: string;
    date: string;
    partyName: string;
    amount: number;
    narration?: string;
  }>;
}

export interface TaxReport {
  totalTaxCollected: number;
  totalTaxPaid: number;
  netTaxLiability: number;
  gstBreakdown: {
    cgst: number;
    sgst: number;
    igst: number;
    cess: number;
  };
  taxByPeriod: Array<{
    period: string;
    collected: number;
    paid: number;
  }>;
}

class ReportService {
  private readonly baseURL = '/reports';

  /**
   * Single round-trip dashboard summary (IST day/month boundaries on the server).
   */
  async getDashboardSummary(companyId: string): Promise<{
    success: boolean;
    data: DashboardSummaryData;
  }> {
    const response = await apiClient.get(`${this.baseURL}/dashboard`, {
      params: { companyId },
    });
    return response.data;
  }

  /**
   * Get financial report
   */
  async getFinancialReport(params: ReportParams): Promise<{
    success: boolean;
    data: FinancialReport;
  }> {
    const response = await apiClient.get(`${this.baseURL}/financial`, { params });
    return response.data;
  }

  /**
   * Get sales report
   */
  async getSalesReport(params: ReportParams): Promise<{
    success: boolean;
    data: SalesReport;
  }> {
    const response = await apiClient.get(`${this.baseURL}/sales`, { params });
    return response.data;
  }

  /**
   * Get inventory report
   */
  async getInventoryReport(params: ReportParams): Promise<{
    success: boolean;
    data: InventoryReport;
  }> {
    const response = await apiClient.get(`${this.baseURL}/inventory`, { params });
    return response.data;
  }

  /**
   * Get tax report
   */
  async getTaxReport(params: ReportParams): Promise<{
    success: boolean;
    data: TaxReport;
  }> {
    const response = await apiClient.get(`${this.baseURL}/tax`, { params });
    return response.data;
  }

  /**
   * Get profit & loss report
   */
  async getProfitLossReport(params: ReportParams): Promise<{
    success: boolean;
    data: {
      period: {
        startDate: string;
        endDate: string;
        periodKey?: string;
        label?: string;
      };
      lastSyncDate?: string | null;
      summary: {
        totalRevenue: number;
        totalExpenses: number;
        netProfit: number;
        profitMargin: number | string;
      };
      revenue: {
        total: number;
        byCategory: Record<string, number>;
        transactions: number;
      };
      expenses: {
        total: number;
        byCategory: Record<string, number>;
        transactions: number;
      };
    };
  }> {
    const query: Record<string, string> = {
      companyId: params.companyId,
    };
    if (params.periodKey) {
      query.periodKey = params.periodKey;
    } else {
      query.startDate = params.startDate || params.dateFrom || '';
      query.endDate = params.endDate || params.dateTo || '';
    }
    const response = await apiClient.get(`${this.baseURL}/profit-loss`, { params: query });
    return response.data;
  }

  async getProfitLossGroupLedgers(params: {
    companyId: string;
    periodKey: ReportPeriodKey;
    groupName: string;
  }): Promise<{
    success: boolean;
    data: {
      groupName: string;
      groupAmount: number;
      ledgers: ProfitLossGroupLedger[];
    };
  }> {
    const response = await apiClient.get(`${this.baseURL}/profit-loss/group-ledgers`, {
      params,
    });
    return response.data;
  }

  async getProfitLossVouchers(params: {
    companyId: string;
    periodKey: ReportPeriodKey;
    ledgerName: string;
  }): Promise<{
    success: boolean;
    data: {
      ledgerName: string;
      count: number;
      vouchers: ProfitLossVoucherRow[];
    };
  }> {
    const response = await apiClient.get(`${this.baseURL}/profit-loss/vouchers`, {
      params,
    });
    return response.data;
  }

  /**
   * Get balance sheet report
   */
  async getBalanceSheetGroupLedgers(params: {
    companyId: string;
    periodKey: ReportPeriodKey;
    groupName: string;
  }): Promise<{
    success: boolean;
    data: {
      groupName: string;
      groupAmount: number;
      ledgers: ProfitLossGroupLedger[];
    };
  }> {
    const response = await apiClient.get(`${this.baseURL}/balance-sheet/group-ledgers`, {
      params,
    });
    return response.data;
  }

  async getBalanceSheetVouchers(params: {
    companyId: string;
    periodKey: ReportPeriodKey;
    ledgerName: string;
  }): Promise<{
    success: boolean;
    data: {
      ledgerName: string;
      count: number;
      vouchers: ProfitLossVoucherRow[];
    };
  }> {
    const response = await apiClient.get(`${this.baseURL}/balance-sheet/vouchers`, {
      params,
    });
    return response.data;
  }

  async getCashBankBookSummary(params: {
    companyId: string;
    periodKey: ReportPeriodKey;
  }): Promise<{
    success: boolean;
    data: CashBankBookSummary;
  }> {
    const response = await apiClient.get(`${this.baseURL}/cash-bank-book`, { params });
    return response.data;
  }

  async getCashBankBookLedgers(params: {
    companyId: string;
    periodKey: ReportPeriodKey;
    parentGroup: string;
  }): Promise<{
    success: boolean;
    data: CashBankBookLedgersData;
  }> {
    const response = await apiClient.get(`${this.baseURL}/cash-bank-book/ledgers`, {
      params,
    });
    return response.data;
  }

  async getCashBankBookVouchers(params: {
    companyId: string;
    periodKey: ReportPeriodKey;
    ledgerName: string;
  }): Promise<{
    success: boolean;
    data: {
      ledgerName: string;
      count: number;
      vouchers: ProfitLossVoucherRow[];
    };
  }> {
    const response = await apiClient.get(`${this.baseURL}/cash-bank-book/vouchers`, {
      params,
    });
    return response.data;
  }

  async getBalanceSheetReport(params: ReportParams): Promise<{
    success: boolean;
    data: {
      period?: {
        periodKey?: string;
        label?: string;
        asOfDate?: string;
      };
      lastSyncDate?: string | null;
      groups?: BalanceSheetGroup[];
      assets: {
        current: Array<{ account: string; amount: number }>;
        fixed: Array<{ account: string; amount: number }>;
        total: number;
      };
      liabilities: {
        current: Array<{ account: string; amount: number }>;
        longTerm: Array<{ account: string; amount: number }>;
        total: number;
      };
      equity: {
        capital: number;
        retainedEarnings: number;
        total: number;
      };
      balanceCheck?: {
        assetsTotal: number;
        liabilitiesAndEquityTotal: number;
        balanced: boolean;
      };
    };
  }> {
    const query: Record<string, string> = {
      companyId: params.companyId,
      periodKey: params.periodKey || 'this_month',
    };
    const response = await apiClient.get(`${this.baseURL}/balance-sheet`, { params: query });
    return response.data;
  }

  /**
   * Get cash flow report
   */
  async getCashFlowReport(params: ReportParams): Promise<{
    success: boolean;
    data: {
      operating: Array<{
        description: string;
        amount: number;
      }>;
      investing: Array<{
        description: string;
        amount: number;
      }>;
      financing: Array<{
        description: string;
        amount: number;
      }>;
      netCashFlow: number;
      openingBalance: number;
      closingBalance: number;
    };
  }> {
    const response = await apiClient.get(`${this.baseURL}/cash-flow`, { params });
    return response.data;
  }

  /**
   * Get trial balance report
   */
  async getTrialBalanceReport(params: ReportParams): Promise<{
    success: boolean;
    data: {
      accounts: Array<{
        account: string;
        debit: number;
        credit: number;
      }>;
      totalDebit: number;
      totalCredit: number;
      isBalanced: boolean;
    };
  }> {
    const response = await apiClient.get(`${this.baseURL}/trial-balance`, { params });
    return response.data;
  }

  /**
   * Get aging report
   */
  async getAgingReport(params: ReportParams & {
    type: 'receivables' | 'payables';
  }): Promise<{
    success: boolean;
    data: {
      parties: Array<{
        name: string;
        current: number;
        days30: number;
        days60: number;
        days90: number;
        over90: number;
        total: number;
      }>;
      summary: {
        current: number;
        days30: number;
        days60: number;
        days90: number;
        over90: number;
        total: number;
      };
    };
  }> {
    const response = await apiClient.get(`${this.baseURL}/aging`, { params });
    return response.data;
  }

  /**
   * Get custom report
   */
  async getCustomReport(reportId: string, params: ReportParams): Promise<{
    success: boolean;
    data: any;
  }> {
    const response = await apiClient.get(`${this.baseURL}/custom/${reportId}`, { params });
    return response.data;
  }

  /**
   * Generate report file
   */
  async generateReportFile(reportType: string, params: ReportParams): Promise<Blob> {
    const response = await apiClient.download(`${this.baseURL}/${reportType}/generate`, {
      params
    });
    return response.data;
  }

  /**
   * Get available reports
   */
  async getAvailableReports(): Promise<{
    success: boolean;
    data: Array<{
      id: string;
      name: string;
      description: string;
      category: string;
      parameters: Array<{
        name: string;
        type: string;
        required: boolean;
        options?: string[];
      }>;
    }>;
  }> {
    const response = await apiClient.get(`${this.baseURL}/available`);
    return response.data;
  }

  /**
   * Schedule report
   */
  async getTop10Report(params: ReportParams): Promise<{
    success: boolean;
    data: TopTenReportData;
  }> {
    // Prefer periodKey — the server resolves boundaries in IST against voucher storage.
    if (params.periodKey) {
      const response = await apiClient.get(`${this.baseURL}/top-10`, {
        params: { companyId: params.companyId, periodKey: params.periodKey },
      });
      return response.data;
    }

    let startDate = params.startDate || params.dateFrom;
    let endDate = params.endDate || params.dateTo;

    if (!startDate || !endDate) {
      const response = await apiClient.get(`${this.baseURL}/top-10`, {
        params: { companyId: params.companyId, periodKey: 'this_month' },
      });
      return response.data;
    }

    const query = {
      companyId: params.companyId,
      startDate,
      endDate,
    };
    const response = await apiClient.get(`${this.baseURL}/top-10`, { params: query });
    return response.data;
  }

  async getOutstandingReceivable(companyId: string): Promise<{
    success: boolean;
    data: OutstandingReceivableSummary;
  }> {
    const response = await apiClient.get(`${this.baseURL}/outstanding-receivable`, {
      params: { companyId },
    });
    return response.data;
  }

  async getOutstandingReceivableLedger(
    companyId: string,
    partyName: string
  ): Promise<{
    success: boolean;
    data: OutstandingLedgerDetail;
  }> {
    const response = await apiClient.get(`${this.baseURL}/outstanding-receivable/ledger`, {
      params: { companyId, partyName },
    });
    return response.data;
  }

  async getOutstandingPayable(companyId: string): Promise<{
    success: boolean;
    data: OutstandingReceivableSummary;
  }> {
    const response = await apiClient.get(`${this.baseURL}/outstanding-payable`, {
      params: { companyId },
    });
    return response.data;
  }

  async getOutstandingPayableLedger(
    companyId: string,
    partyName: string
  ): Promise<{
    success: boolean;
    data: OutstandingLedgerDetail;
  }> {
    const response = await apiClient.get(`${this.baseURL}/outstanding-payable/ledger`, {
      params: { companyId, partyName },
    });
    return response.data;
  }

  /** Receivable and payable share a response shape — pick the endpoint by kind. */
  getOutstanding(kind: OutstandingKind, companyId: string) {
    return kind === 'payable'
      ? this.getOutstandingPayable(companyId)
      : this.getOutstandingReceivable(companyId);
  }

  getOutstandingLedger(kind: OutstandingKind, companyId: string, partyName: string) {
    return kind === 'payable'
      ? this.getOutstandingPayableLedger(companyId, partyName)
      : this.getOutstandingReceivableLedger(companyId, partyName);
  }

  async getInactiveCustomers(params: {
    companyId: string;
    inactiveDays: string;
    customDays?: number;
  }): Promise<{ success: boolean; data: InactiveCustomersData }> {
    const query: Record<string, string> = {
      companyId: params.companyId,
      inactiveDays: params.inactiveDays,
    };
    if (params.customDays != null) {
      query.customDays = String(params.customDays);
    }
    const response = await apiClient.get(`${this.baseURL}/inactive-customers`, {
      params: query,
    });
    return response.data;
  }

  async getInactiveItems(params: {
    companyId: string;
    inactiveDays: string;
    customDays?: number;
  }): Promise<{ success: boolean; data: InactiveItemsData }> {
    const query: Record<string, string> = {
      companyId: params.companyId,
      inactiveDays: params.inactiveDays,
    };
    if (params.customDays != null) {
      query.customDays = String(params.customDays);
    }
    const response = await apiClient.get(`${this.baseURL}/inactive-items`, {
      params: query,
    });
    return response.data;
  }

  async getFastMovingItems(params: {
    companyId: string;
    periodKey: ReportPeriodKey;
    limit?: number;
  }): Promise<{ success: boolean; data: FastMovingItemsData }> {
    const response = await apiClient.get(`${this.baseURL}/fast-moving-items`, {
      params,
    });
    return response.data;
  }

  async scheduleReport(scheduleData: {
    reportType: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    recipients: string[];
    format: 'pdf' | 'excel' | 'csv';
    parameters: ReportParams;
  }): Promise<{
    success: boolean;
    message: string;
    scheduleId: string;
  }> {
    const response = await apiClient.post(`${this.baseURL}/schedule`, scheduleData);
    return response.data;
  }
}

export const reportService = new ReportService();
