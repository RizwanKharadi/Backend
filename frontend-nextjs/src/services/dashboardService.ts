import api, { ApiRequestConfig } from '@/lib/api';

const mlConfig: ApiRequestConfig = { silentError: true };
import { ApiResponse } from '@/types';

export interface DashboardStats {
  totalRevenue: number;
  totalVouchers: number;
  inventoryItems: number;
  overduePayments: number;
  revenueChange: number;
  vouchersChange: number;
  inventoryChange: number;
  overdueChange: number;
}

export interface RecentActivity {
  id: string;
  type: 'voucher_created' | 'payment_received' | 'item_added' | 'sync_completed';
  title: string;
  description: string;
  timestamp: string;
  user: string;
  metadata?: Record<string, any>;
}

export interface QuickAction {
  id: string;
  title: string;
  description: string;
  icon: string;
  href: string;
  color: 'primary' | 'success' | 'warning' | 'error';
}

export interface DashboardData {
  stats: DashboardStats;
  recentActivities: RecentActivity[];
  quickActions: QuickAction[];
  alerts: {
    id: string;
    type: 'info' | 'warning' | 'error' | 'success';
    title: string;
    message: string;
    timestamp: string;
  }[];
}

export const dashboardService = {
  // Get dashboard overview data
  async getDashboardData(_companyId: string): Promise<ApiResponse<DashboardData>> {
    return {
      success: true,
      data: {
        stats: await this.getStats(_companyId).then((r) => r.data!),
        recentActivities: [],
        quickActions: [],
        alerts: [],
      },
    };
  },

  // Get dashboard stats (from reports API)
  async getStats(companyId: string, _period: '7d' | '30d' | '90d' | '1y' = '30d'): Promise<ApiResponse<DashboardStats>> {
    const response = await api.get<ApiResponse<{
      thisMonth?: { sales?: number; purchases?: number };
      yearToDate?: { sales?: number };
      outstanding?: { receivables?: number };
    }>>('/reports/dashboard', {
      params: { companyId },
    });
    const d = response.data.data;
    return {
      success: true,
      data: {
        totalRevenue: d?.yearToDate?.sales ?? d?.thisMonth?.sales ?? 0,
        totalVouchers: 0,
        inventoryItems: 0,
        overduePayments: d?.outstanding?.receivables ?? 0,
        revenueChange: 0,
        vouchersChange: 0,
        inventoryChange: 0,
        overdueChange: 0,
      },
    };
  },

  // Get recent activities (not implemented on backend yet)
  async getRecentActivities(_companyId: string, _limit: number = 10): Promise<ApiResponse<RecentActivity[]>> {
    return { success: true, data: [] };
  },

  // Get alerts (not implemented on backend yet)
  async getAlerts(_companyId: string): Promise<ApiResponse<DashboardData['alerts']>> {
    return { success: true, data: [] };
  },

  // Mark alert as read
  async markAlertAsRead(_alertId: string): Promise<ApiResponse> {
    return { success: true };
  },

  // Get business metrics from ML service
  async getBusinessMetrics(companyId: string, daysBack: number = 30): Promise<ApiResponse<any>> {
    const response = await api.get<ApiResponse<any>>(`/ml/business-metrics`, {
      ...mlConfig,
      params: { company_id: companyId, days_back: daysBack },
    });
    return response.data;
  },

  // Get payment trends
  async getPaymentTrends(companyId: string): Promise<ApiResponse<any>> {
    const response = await api.get<ApiResponse<any>>(`/ml/payment-trends`, {
      ...mlConfig,
      params: { company_id: companyId },
    });
    return response.data;
  },

  // Get inventory analytics
  async getInventoryAnalytics(companyId: string): Promise<ApiResponse<any>> {
    const response = await api.get<ApiResponse<any>>(`/ml/inventory-analytics`, {
      ...mlConfig,
      params: { company_id: companyId },
    });
    return response.data;
  },

  // Get risk dashboard data
  async getRiskDashboard(companyId: string): Promise<ApiResponse<any>> {
    const response = await api.get<ApiResponse<any>>(`/ml/risk-dashboard`, {
      ...mlConfig,
      params: { company_id: companyId },
    });
    return response.data;
  },
};
