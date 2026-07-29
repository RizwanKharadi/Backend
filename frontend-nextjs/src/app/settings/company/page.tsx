'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import SettingsShell from '@/components/settings/SettingsShell';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';
import { useCompany } from '@/contexts/CompanyContext';
import { toast } from 'react-hot-toast';

export default function CompanySettingsPage() {
  const { currentCompany, updateCompany } = useCompany();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    displayName: '',
    industry: '',
    gstin: '',
  });

  useEffect(() => {
    if (currentCompany) {
      setForm({
        name: currentCompany.name || '',
        displayName: currentCompany.displayName || '',
        industry: currentCompany.industry || '',
        gstin: currentCompany.gstin || '',
      });
    }
  }, [currentCompany]);

  if (!currentCompany) {
    return (
      <SettingsShell title="Company Settings">
        <p className="text-gray-600">Select a company first.</p>
        <Link href="/companies" className="text-primary-600 text-sm font-medium">
          Go to Companies
        </Link>
      </SettingsShell>
    );
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await updateCompany(currentCompany._id, {
        name: form.name,
        displayName: form.displayName,
        industry: form.industry,
        gstin: form.gstin,
      });
      toast.success('Company updated');
    } catch {
      // toast from context
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SettingsShell
      title="Company Settings"
      description={`Manage ${currentCompany.displayName || currentCompany.name}`}
    >
      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6 space-y-4 max-w-lg">
        <Input label="Company name" name="name" value={form.name} onChange={handleChange} required />
        <Input label="Display name" name="displayName" value={form.displayName} onChange={handleChange} />
        <Input label="Industry" name="industry" value={form.industry} onChange={handleChange} />
        <Input label="GSTIN" name="gstin" value={form.gstin} onChange={handleChange} />
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving...' : 'Save Changes'}
        </Button>
      </form>
    </SettingsShell>
  );
}
