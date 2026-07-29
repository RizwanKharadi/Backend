'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCompany } from '@/contexts/CompanyContext';
import ReportShell from '@/components/reports/ReportShell';
import ReportDataView from '@/components/reports/ReportDataView';
import Button from '@/components/common/Button';
import { ReportPeriodKey } from '@/lib/reportPeriods';
import { reportService } from '@/services/reportService';

type ReportSlug =
  | 'profit-loss'
  | 'balance-sheet'
  | 'cash-flow'
  | 'trial-balance'
  | 'gstr-1'
  | 'gstr-3b'
  | 'gst-summary'
  | 'itc'
  | 'stock-summary'
  | 'stock-movement'
  | 'stock-valuation'
  | 'reorder-level'
  | 'sales-summary'
  | 'outstanding'
  | 'top-customers'
  | 'expense-analysis';

const REPORT_META: Record<
  ReportSlug,
  { title: string; description: string; showPeriod: boolean }
> = {
  'profit-loss': {
    title: 'Profit & Loss Statement',
    description: 'Synced from Tally via desktop-agent.',
    showPeriod: true,
  },
  'balance-sheet': {
    title: 'Balance Sheet',
    description: 'Synced from Tally via desktop-agent.',
    showPeriod: true,
  },
  'cash-flow': {
    title: 'Cash Flow Statement',
    description: 'Receipts and payments for the selected period.',
    showPeriod: true,
  },
  'trial-balance': {
    title: 'Trial Balance',
    description: 'Day book entries for the selected period.',
    showPeriod: true,
  },
  'gstr-1': {
    title: 'GSTR-1',
    description: 'GST outward return records.',
    showPeriod: false,
  },
  'gstr-3b': {
    title: 'GSTR-3B',
    description: 'GST summary return records.',
    showPeriod: false,
  },
  'gst-summary': {
    title: 'GST Summary',
    description: 'All GST returns for this company.',
    showPeriod: false,
  },
  itc: {
    title: 'Input Tax Credit',
    description: 'GST returns with ITC details (when generated).',
    showPeriod: false,
  },
  'stock-summary': {
    title: 'Stock Summary',
    description: 'Inventory overview from synced data.',
    showPeriod: false,
  },
  'stock-movement': {
    title: 'Stock Movement',
    description: 'Inventory items list (movement detail coming soon).',
    showPeriod: false,
  },
  'stock-valuation': {
    title: 'Stock Valuation',
    description: 'Total inventory value from synced items.',
    showPeriod: false,
  },
  'reorder-level': {
    title: 'Reorder Level',
    description: 'Items at or below reorder level.',
    showPeriod: false,
  },
  'sales-summary': {
    title: 'Sales Summary',
    description: 'Sales vouchers for the selected period.',
    showPeriod: true,
  },
  outstanding: {
    title: 'Outstanding Receivables',
    description: 'Pending customer balances from Tally sync.',
    showPeriod: false,
  },
  'top-customers': {
    title: 'Top Customers',
    description: 'Top 10 customers by sales value.',
    showPeriod: true,
  },
  'expense-analysis': {
    title: 'Expense Analysis',
    description: 'Purchase summary for the selected period.',
    showPeriod: true,
  },
};

function isReportSlug(slug: string): slug is ReportSlug {
  return slug in REPORT_META;
}

export default function ReportSlugPage() {
  const params = useParams();
  const slug = String(params?.slug || '');
  const { currentCompany } = useCompany();
  const [periodKey, setPeriodKey] = useState<ReportPeriodKey>('this_month');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<unknown>(null);

  const meta = isReportSlug(slug) ? REPORT_META[slug] : null;

  const load = useCallback(async () => {
    if (!meta || !currentCompany) return;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const companyId = currentCompany._id;
      let res;

      switch (slug as ReportSlug) {
        case 'profit-loss':
          res = await reportService.getProfitLoss(companyId, periodKey);
          break;
        case 'balance-sheet':
          res = await reportService.getBalanceSheet(companyId, periodKey);
          break;
        case 'cash-flow':
          res = await reportService.getCashFlow(companyId, periodKey);
          break;
        case 'trial-balance':
          res = await reportService.getDaybook(companyId, periodKey);
          break;
        case 'gstr-1':
          res = await reportService.getGstReturns(companyId, 'GSTR1');
          break;
        case 'gstr-3b':
          res = await reportService.getGstReturns(companyId, 'GSTR3B');
          break;
        case 'gst-summary':
        case 'itc':
          res = await reportService.getGstReturns(companyId);
          break;
        case 'stock-summary':
        case 'stock-valuation': {
          res = await reportService.getInventoryStats(companyId);
          break;
        }
        case 'stock-movement': {
          res = await reportService.getInventoryItems(companyId);
          break;
        }
        case 'reorder-level': {
          res = await reportService.getLowStockItems(companyId);
          break;
        }
        case 'sales-summary':
          res = await reportService.getSales(companyId, periodKey);
          break;
        case 'outstanding':
          res = await reportService.getOutstandingReceivable(companyId);
          break;
        case 'top-customers':
          res = await reportService.getTop10(companyId, periodKey);
          break;
        case 'expense-analysis':
          res = await reportService.getPurchase(companyId, periodKey);
          break;
        default:
          throw new Error('Unknown report');
      }

      const body = res.data;
      if (body?.success === false) {
        throw new Error(body.message || 'Failed to load report');
      }
      let payload = body?.data ?? body;
      if (payload?.docs && Array.isArray(payload.docs)) {
        payload = { items: payload.docs };
      }
      setData(payload);
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { message?: string; code?: string } } };
      const msg =
        ax.response?.data?.message ||
        (err instanceof Error ? err.message : 'Failed to load report');
      if (ax.response?.data?.code === 'REPORT_NOT_SYNCED') {
        setError(
          `${msg} Open TallyPrime on your PC and run sync in desktop-agent, then try again.`
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [slug, currentCompany, periodKey, meta]);

  useEffect(() => {
    if (currentCompany && meta) load();
  }, [load, currentCompany, meta]);

  if (!isReportSlug(slug) || !meta) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Report not found</h2>
        <p className="mt-2 text-gray-600">No report page for &quot;{slug}&quot;.</p>
        <Link href="/reports" className="mt-4 inline-block">
          <Button>Back to Reports</Button>
        </Link>
      </div>
    );
  }

  if (!currentCompany) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">No company selected</h2>
        <Link href="/companies" className="mt-4 inline-block">
          <Button>Select Company</Button>
        </Link>
      </div>
    );
  }

  return (
    <ReportShell
      title={meta.title}
      description={meta.description}
      loading={loading}
      error={error}
      periodKey={periodKey}
      onPeriodChange={setPeriodKey}
      showPeriod={meta.showPeriod}
    >
      <ReportDataView data={data} />
    </ReportShell>
  );
}
