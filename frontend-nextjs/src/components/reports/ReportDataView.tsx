'use client';

import React from 'react';
import { formatCurrency, formatNumber } from '@/lib/utils';

function isMoneyKey(key: string): boolean {
  return /amount|total|revenue|expense|profit|balance|value|sales|purchase|outstanding|debit|credit|flow/i.test(
    key
  );
}

function renderValue(key: string, value: unknown): React.ReactNode {
  if (value == null) return '—';
  if (typeof value === 'number' && isMoneyKey(key)) return formatCurrency(value);
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return null;
  return String(value);
}

function KeyValueGrid({ data, title }: { data: Record<string, unknown>; title?: string }) {
  const entries = Object.entries(data).filter(([, v]) => v != null && typeof v !== 'object');
  if (!entries.length) return null;
  return (
    <div className="bg-white shadow rounded-lg p-4">
      {title && <h3 className="text-sm font-semibold text-gray-900 mb-3">{title}</h3>}
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-gray-500 capitalize">{k.replace(/([A-Z])/g, ' $1')}</dt>
            <dd className="text-sm font-medium text-gray-900">{renderValue(k, v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SimpleTable({
  rows,
  columns,
}: {
  rows: Record<string, unknown>[];
  columns: { key: string; label: string }[];
}) {
  if (!rows.length) {
    return <p className="text-sm text-gray-500 py-4">No rows in this report.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className="px-4 py-2 text-gray-900 whitespace-nowrap">
                  {renderValue(c.key, row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Renders common API report shapes without crashing on unknown JSON */
export default function ReportDataView({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') {
    return <p className="text-sm text-gray-500">No report data.</p>;
  }

  const d = data as Record<string, unknown>;

  if (d.summary && typeof d.summary === 'object') {
    return (
      <div className="space-y-4">
        <KeyValueGrid data={d.summary as Record<string, unknown>} title="Summary" />
        {Array.isArray(d.groups) && (d.groups as Record<string, unknown>[]).length > 0 && (
          <div className="bg-white shadow rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Groups</h3>
            <SimpleTable
              rows={d.groups as Record<string, unknown>[]}
              columns={[
                { key: 'name', label: 'Name' },
                { key: 'amount', label: 'Amount' },
                { key: 'side', label: 'Side' },
                { key: 'section', label: 'Section' },
              ]}
            />
          </div>
        )}
        {d.revenue && typeof d.revenue === 'object' && (
          <KeyValueGrid data={d.revenue as Record<string, unknown>} title="Revenue" />
        )}
        {d.expenses && typeof d.expenses === 'object' && (
          <KeyValueGrid data={d.expenses as Record<string, unknown>} title="Expenses" />
        )}
      </div>
    );
  }

  if (Array.isArray(d.ledgers)) {
    return (
      <div className="bg-white shadow rounded-lg p-4">
        <SimpleTable
          rows={d.ledgers as Record<string, unknown>[]}
          columns={[
            { key: 'partyName', label: 'Party' },
            { key: 'totalOutstanding', label: 'Outstanding' },
            { key: 'billCount', label: 'Bills' },
          ]}
        />
      </div>
    );
  }

  if (Array.isArray(d.topCustomers)) {
    return (
      <div className="space-y-4">
        {['topCustomers', 'topSuppliers', 'itemsSoldByValue'].map((key) => {
          const rows = d[key];
          if (!Array.isArray(rows) || !rows.length) return null;
          return (
            <div key={key} className="bg-white shadow rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 capitalize">
                {key.replace(/([A-Z])/g, ' $1')}
              </h3>
              <SimpleTable
                rows={rows as Record<string, unknown>[]}
                columns={[
                  { key: 'rank', label: '#' },
                  { key: 'name', label: 'Name' },
                  { key: 'totalAmount', label: 'Amount' },
                  { key: 'sharePercent', label: 'Share %' },
                ]}
              />
            </div>
          );
        })}
      </div>
    );
  }

  if (Array.isArray(d.items)) {
    return (
      <div className="bg-white shadow rounded-lg p-4">
        <SimpleTable
          rows={d.items as Record<string, unknown>[]}
          columns={[
            { key: 'name', label: 'Item' },
            { key: 'code', label: 'Code' },
            { key: 'type', label: 'Type' },
          ]}
        />
      </div>
    );
  }

  if (Array.isArray(d.returns)) {
    return (
      <div className="bg-white shadow rounded-lg p-4">
        <SimpleTable
          rows={d.returns as Record<string, unknown>[]}
          columns={[
            { key: 'returnType', label: 'Type' },
            { key: 'filingStatus', label: 'Status' },
            { key: 'returnPeriod', label: 'Period' },
          ]}
        />
      </div>
    );
  }

  if (Array.isArray(d.data)) {
    return (
      <div className="bg-white shadow rounded-lg p-4">
        <pre className="text-xs overflow-auto max-h-96">{JSON.stringify(d.data, null, 2)}</pre>
      </div>
    );
  }

  if (Array.isArray(d)) {
    return (
      <div className="bg-white shadow rounded-lg p-4">
        <pre className="text-xs overflow-auto max-h-96">{JSON.stringify(d, null, 2)}</pre>
      </div>
    );
  }

  return (
    <div className="bg-white shadow rounded-lg p-4">
      <KeyValueGrid data={d} />
      <details className="mt-4">
        <summary className="text-xs text-gray-500 cursor-pointer">Raw JSON</summary>
        <pre className="text-xs overflow-auto max-h-96 mt-2">{JSON.stringify(d, null, 2)}</pre>
      </details>
    </div>
  );
}
