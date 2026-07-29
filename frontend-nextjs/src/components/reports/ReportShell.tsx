'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { REPORT_PERIOD_OPTIONS, ReportPeriodKey } from '@/lib/reportPeriods';

interface ReportShellProps {
  title: string;
  description?: string;
  loading?: boolean;
  error?: string | null;
  periodKey?: ReportPeriodKey;
  onPeriodChange?: (key: ReportPeriodKey) => void;
  showPeriod?: boolean;
  children: React.ReactNode;
}

export default function ReportShell({
  title,
  description,
  loading,
  error,
  periodKey = 'this_month',
  onPeriodChange,
  showPeriod = true,
  children,
}: ReportShellProps) {
  return (
    <div className="space-y-6">
      <Link
        href="/reports"
        className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeftIcon className="h-4 w-4 mr-1" />
        Back to Reports
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {description && <p className="mt-1 text-sm text-gray-600">{description}</p>}
        </div>
        {showPeriod && onPeriodChange && (
          <select
            value={periodKey}
            onChange={(e) => onPeriodChange(e.target.value as ReportPeriodKey)}
            className="rounded-md border-gray-300 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
          >
            {REPORT_PERIOD_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-warning-200 bg-warning-50 p-4 text-sm text-warning-800">
          {error}
        </div>
      )}

      {!loading && !error && children}
    </div>
  );
}
