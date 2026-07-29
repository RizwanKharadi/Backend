'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { CreditCardIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { billingService, BillingCycle } from '@/services/billingService';
import Button from '@/components/common/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from 'react-hot-toast';

export default function BillingSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [plans, setPlans] = useState<Record<string, unknown>[]>([]);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [seatLimit, setSeatLimit] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([
        billingService.getStatus(),
        billingService.getPlans()
      ]);
      setStatus(s);
      setPlans(p);
      const sub = s?.subscription as { seatLimit?: number } | undefined;
      if (sub?.seatLimit) setSeatLimit(sub.seatLimit);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      toast.error(err?.response?.data?.message || 'Failed to load billing');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubscribe = async () => {
    setSubmitting(true);
    try {
      const checkout = await billingService.subscribe(billingCycle, seatLimit);
      if (checkout.shortUrl) {
        window.open(checkout.shortUrl, '_blank');
        toast.success('Complete payment, then click Refresh status.');
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      toast.error(err?.response?.data?.message || 'Checkout failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSync = async () => {
    try {
      await billingService.sync();
      toast.success('Subscription synced');
      await load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      toast.error(err?.response?.data?.message || 'Sync failed');
    }
  };

  if (loading) return <p className="text-gray-500">Loading billing…</p>;

  const access = status?.access as { allowed?: boolean; reason?: string } | undefined;
  const sub = status?.subscription as {
    status?: string;
    seatLimit?: number;
    trialEndsAt?: string;
    currentPeriodEnd?: string;
  } | undefined;

  return (
    <div>
      <div className="mb-6">
        <Link href="/settings" className="text-sm text-primary-600 hover:underline">
          ← Back to settings
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2 flex items-center gap-2">
          <CreditCardIcon className="h-8 w-8 text-primary-600" />
          Billing & Subscription
        </h1>
        <p className="text-gray-600 mt-1">
          Per-device pricing. Mobile app access is included.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Current plan</h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600">Status</span>
              <Badge variant={access?.allowed ? 'success' : 'error'}>
                {sub?.status || 'unknown'}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Device seats</span>
              <span>
                {(status?.seatsUsed as number) ?? 0} / {sub?.seatLimit ?? 0} used
              </span>
            </div>
            {sub?.trialEndsAt && (
              <div className="flex justify-between">
                <span className="text-gray-600">Trial ends</span>
                <span>{new Date(sub.trialEndsAt).toLocaleDateString()}</span>
              </div>
            )}
            {!access?.allowed && (
              <p className="text-sm text-amber-700 bg-amber-50 p-3 rounded-md">
                {access?.reason || 'Subscription inactive'}
              </p>
            )}
          </div>
          <Button variant="outline" className="mt-4" onClick={handleSync}>
            Refresh status
          </Button>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Subscribe</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Billing cycle</label>
              <select
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                value={billingCycle}
                onChange={(e) => setBillingCycle(e.target.value as BillingCycle)}
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tally PCs (devices)</label>
              <input
                type="number"
                min={1}
                max={50}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                value={seatLimit}
                onChange={(e) => setSeatLimit(parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <Button onClick={handleSubscribe} disabled={submitting} className="w-full">
              Pay with Razorpay
              <ArrowTopRightOnSquareIcon className="h-4 w-4 inline ml-2" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}