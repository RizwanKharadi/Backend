/**
 * TallyFin — Dashboard mock data.
 * Mirrors the approved reference design. Swap these values for live
 * Redux/report selectors when wiring real data — the shapes are identical
 * to src/types/dashboard.ts.
 */
import { actionGradients, colors } from '../theme/colors';
import {
  DashboardData,
  NavItem,
  QuickAction,
} from '../types/dashboard';

export const dashboardMock: DashboardData = {
  header: {
    greeting: 'Good Afternoon',
    userName: 'Asif',
    companyName: 'AIM INFOCOM SERVICES',
    sync: { online: true, label: 'Synced 2 mins ago' },
    subscription: { type: 'trial', label: 'Trial · 7 Days Left' },
    unreadNotifications: 3,
  },
  netWorth: {
    value: '₹34.34L',
    trendLabel: '+12.4% this month',
    trendPositive: true,
  },
  receivables: {
    value: '₹3.74L',
    partiesLabel: '34 Parties',
    progress: 0.68,
    ringCenterValue: '34',
    ringCenterLabel: 'Overdue',
  },
  kpis: [
    {
      id: 'revenue',
      label: 'Revenue',
      value: '₹12.28L',
      deltaLabel: '18.6%',
      deltaPositive: true,
      icon: 'trending-up',
      accent: 'green',
      spark: [8, 10, 7, 12, 11, 15, 14, 18],
    },
    {
      id: 'outstanding',
      label: 'Outstanding',
      value: '₹3.74L',
      deltaLabel: '34 overdue',
      deltaPositive: false,
      icon: 'account-group',
      accent: 'orange',
      spark: [14, 12, 15, 13, 16, 12, 18, 17],
    },
    {
      id: 'bank',
      label: 'Bank Balance',
      value: '₹34.34L',
      deltaLabel: '11.3%',
      deltaPositive: true,
      icon: 'bank',
      accent: 'purple',
      spark: [20, 22, 19, 24, 23, 27, 30, 32],
    },
    {
      id: 'profit',
      label: 'Profit This Month',
      value: '₹6.03L',
      deltaLabel: '4.1%',
      deltaPositive: true,
      icon: 'chart-box',
      accent: 'red',
      spark: [10, 9, 12, 11, 8, 12, 10, 13],
    },
  ],
  salesTrend: {
    value: '₹3.02L',
    growthLabel: '+12.4%',
    growthPositive: true,
    series: {
      '7D': {
        labels: ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue'],
        values: [42000, 38000, 51000, 47000, 33000, 86465, 72000],
      },
      '30D': {
        labels: ['W1', 'W2', 'W3', 'W4'],
        values: [210000, 265000, 240000, 302000],
      },
      '90D': {
        labels: ['Apr', 'May', 'Jun'],
        values: [820000, 910000, 1050000],
      },
    },
  },
  quickActions: [],
  topOutstanding: [
    { id: '1', name: 'Samira Chemicals Pvt Ltd', amount: '₹1.25L', status: 'overdue' },
    { id: '2', name: 'A.A. Mehta & Associates', amount: '₹98,650', status: 'overdue' },
    { id: '3', name: 'Supreme Technology', amount: '₹76,200', status: 'overdue' },
    { id: '4', name: 'Think Foundation', amount: '₹45,300', status: 'dueSoon' },
  ],
};

export const quickActions: QuickAction[] = [
  {
    key: 'salesInvoice',
    title: 'Sales Invoice',
    icon: 'file-document-outline',
    gradient: actionGradients.salesInvoice,
  },
  {
    key: 'receipt',
    title: 'Receipt',
    icon: 'download-outline',
    gradient: actionGradients.receipt,
  },
  {
    key: 'payment',
    title: 'Payment',
    icon: 'credit-card-outline',
    gradient: actionGradients.payment,
  },
  {
    key: 'expense',
    title: 'Expense',
    icon: 'wallet-outline',
    gradient: actionGradients.expense,
  },
];

// Quick actions live alongside the rest of the dashboard payload.
dashboardMock.quickActions = quickActions;


// Labels are translation keys, not text: this list is module scope, where no
// hook can reach, and BottomNavigation resolves them at render.
export const navItems: NavItem[] = [
  { key: 'dashboard', labelKey: 'nav.dashboard', icon: 'view-dashboard-outline' },
  { key: 'transactions', labelKey: 'nav.transactions', icon: 'swap-horizontal' },
  { key: 'inventory', labelKey: 'nav.inventory', icon: 'package-variant-closed' },
  { key: 'reports', labelKey: 'nav.reports', icon: 'chart-box-outline' },
];
