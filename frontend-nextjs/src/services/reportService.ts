import api, { ApiRequestConfig } from '@/lib/api';
import { ReportPeriodKey, resolvePeriodDates } from '@/lib/reportPeriods';

const silent: ApiRequestConfig = { silentError: true };

export const reportService = {
  getProfitLoss(companyId: string, periodKey: ReportPeriodKey = 'this_month') {
    return api.get('/reports/profit-loss', {
      params: { companyId, periodKey },
    });
  },

  getBalanceSheet(companyId: string, periodKey: ReportPeriodKey = 'this_month') {
    return api.get('/reports/balance-sheet', {
      params: { companyId, periodKey },
    });
  },

  getCashFlow(companyId: string, periodKey: ReportPeriodKey = 'this_month') {
    const { startDate, endDate } = resolvePeriodDates(periodKey);
    return api.get('/reports/cash-flow', {
      params: { companyId, startDate, endDate },
    });
  },

  getSales(companyId: string, periodKey: ReportPeriodKey = 'this_month') {
    const { startDate, endDate } = resolvePeriodDates(periodKey);
    return api.get('/reports/sales', { params: { companyId, startDate, endDate } });
  },

  getPurchase(companyId: string, periodKey: ReportPeriodKey = 'this_month') {
    const { startDate, endDate } = resolvePeriodDates(periodKey);
    return api.get('/reports/purchase', { params: { companyId, startDate, endDate } });
  },

  getOutstandingReceivable(companyId: string) {
    return api.get('/reports/outstanding-receivable', { params: { companyId } });
  },

  getTop10(companyId: string, periodKey: ReportPeriodKey = 'this_month') {
    const { startDate, endDate } = resolvePeriodDates(periodKey);
    return api.get('/reports/top-10', { params: { companyId, startDate, endDate } });
  },

  getDaybook(companyId: string, periodKey: ReportPeriodKey = 'this_month') {
    const { startDate, endDate } = resolvePeriodDates(periodKey);
    return api.get('/reports/daybook', { params: { companyId, fromDate: startDate, toDate: endDate } });
  },

  getGstReturns(companyId: string, returnType?: string) {
    return api.get('/gst/returns', {
      params: { companyId, returnType, limit: 50 },
      ...silent,
    });
  },

  getInventoryStats(companyId: string) {
    return api.get('/inventory/stats', { params: { companyId } });
  },

  getLowStockItems(companyId: string) {
    return api.get('/inventory/items', {
      params: { companyId, lowStock: 'true', limit: 100 },
      ...silent,
    });
  },

  getInventoryItems(companyId: string, page = 1) {
    return api.get('/inventory/items', {
      params: { companyId, page, limit: 50 },
      ...silent,
    });
  },
};
