'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { adminService } from '@/services/adminService';
import { Badge } from '@/components/ui/Badge';
import Button from '@/components/common/Button';
import { toast } from 'react-hot-toast';

type OrgRow = {
  _id: string;
  name: string;
  billingEmail?: string;
  subscription?: { status?: string; seatLimit?: number };
};

type DeviceRow = {
  _id: string;
  agentId: string;
  status: string;
  hostname?: string;
  organization?: { _id?: string; name?: string };
};

export default function AdminPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [transferAgentId, setTransferAgentId] = useState<string | null>(null);
  const [targetOrgId, setTargetOrgId] = useState('');
  const [transferring, setTransferring] = useState(false);

  const loadDevices = useCallback(async () => {
    const devRes = await adminService.listDevices({ limit: 50 });
    setDevices((devRes.data || []) as DeviceRow[]);
  }, []);

  const loadAll = useCallback(async () => {
    const [o, orgRes] = await Promise.all([
      adminService.getOverview(),
      adminService.listOrganizations({ limit: 100 })
    ]);
    setOverview(o);
    setOrgs((orgRes.data || []) as OrgRow[]);
    await loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    if (user && user.role !== 'superadmin') {
      router.replace('/dashboard');
      return;
    }
    if (!user) return;

    const load = async () => {
      try {
        await loadAll();
      } catch {
        toast.error('Admin access required');
        router.replace('/dashboard');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user, router, loadAll]);

  const extendTrial = async (orgId: string) => {
    try {
      await adminService.updateSubscription(orgId, { extendTrialDays: 7 });
      toast.success('Trial extended 7 days');
      const orgRes = await adminService.listOrganizations({ limit: 100 });
      setOrgs((orgRes.data || []) as OrgRow[]);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      toast.error(err?.response?.data?.message || 'Failed');
    }
  };

  const startTransfer = (device: DeviceRow) => {
    setTransferAgentId(device.agentId);
    const currentOrgId = device.organization?._id || '';
    const fallbackOrg = orgs.find((o) => o._id !== currentOrgId);
    setTargetOrgId(fallbackOrg?._id || '');
  };

  const cancelTransfer = () => {
    setTransferAgentId(null);
    setTargetOrgId('');
  };

  const confirmTransfer = async () => {
    if (!transferAgentId || !targetOrgId) {
      toast.error('Select a target organization');
      return;
    }
    setTransferring(true);
    try {
      const res = await adminService.transferDevice(
        transferAgentId,
        targetOrgId,
        'Transferred by platform admin'
      );
      toast.success(res.message || 'Device transferred');
      cancelTransfer();
      await loadDevices();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      toast.error(err?.response?.data?.message || 'Transfer failed');
    } finally {
      setTransferring(false);
    }
  };

  if (loading) return <p className="text-gray-500">Loading admin…</p>;
  if (user?.role !== 'superadmin') return null;

  const subs = overview?.subscriptions as Record<string, number> | undefined;
  const dev = overview?.devices as Record<string, number> | undefined;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Platform Admin</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Organizations" value={overview?.organizations as number} />
        <StatCard label="Active subs" value={subs?.active} />
        <StatCard label="On trial" value={subs?.trial} />
        <StatCard label="Active devices" value={dev?.active} />
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        <section className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold mb-3">Organizations</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {orgs.map((org) => (
              <div
                key={org._id}
                className="flex items-center justify-between border-b py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{org.name}</p>
                  <p className="text-gray-500 text-xs">{org.billingEmail}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge>{org.subscription?.status || '—'}</Badge>
                  <span className="text-xs text-gray-500">{org.subscription?.seatLimit} seats</span>
                  <Button size="sm" variant="outline" onClick={() => extendTrial(org._id)}>
                    +7d trial
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold mb-3">Devices</h2>
          <p className="text-xs text-gray-500 mb-3">
            Transfer moves a PC license to another organization (fixes &quot;registered to another
            organization&quot;). User must sign in again on the desktop agent.
          </p>
          <div className="space-y-2 max-h-96 overflow-y-auto text-sm">
            {devices.map((devRow) => (
              <div key={devRow._id} className="border-b py-2">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs truncate">{devRow.agentId}</p>
                    <p className="text-gray-500">{devRow.organization?.name || '—'}</p>
                    {devRow.hostname ? (
                      <p className="text-gray-400 text-xs">{devRow.hostname}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge>{devRow.status}</Badge>
                    <Button size="sm" variant="outline" onClick={() => startTransfer(devRow)}>
                      Transfer
                    </Button>
                  </div>
                </div>
                {transferAgentId === devRow.agentId ? (
                  <div className="mt-2 p-2 bg-gray-50 rounded border space-y-2">
                    <label className="block text-xs text-gray-600">
                      Target organization
                      <select
                        className="mt-1 w-full border rounded px-2 py-1 text-sm bg-white"
                        value={targetOrgId}
                        onChange={(e) => setTargetOrgId(e.target.value)}
                      >
                        <option value="">Select organization…</option>
                        {orgs.map((org) => (
                          <option key={org._id} value={org._id}>
                            {org.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={confirmTransfer}
                        disabled={transferring || !targetOrgId}
                      >
                        {transferring ? 'Transferring…' : 'Confirm transfer'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={cancelTransfer} disabled={transferring}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </div>

      <p className="mt-6 text-sm text-gray-500">
        <Link href="/settings/billing" className="text-primary-600 hover:underline">
          Customer billing page
        </Link>
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value?: number }) {
  return (
    <div className="bg-white border rounded-lg p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold">{value ?? '—'}</p>
    </div>
  );
}
