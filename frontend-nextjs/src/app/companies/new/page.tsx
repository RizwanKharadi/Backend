'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Breadcrumb from '@/components/ui/Breadcrumb';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';
import { useCompany } from '@/contexts/CompanyContext';
import { toast } from 'react-hot-toast';

export default function NewCompanyPage() {
  const router = useRouter();
  const { createCompany, setCurrentCompany } = useCompany();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    displayName: '',
    industry: '',
    businessType: 'proprietorship',
    gstin: '',
    addressLine1: '',
    city: '',
    state: '',
    pincode: '',
    phone: '',
    email: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        displayName: form.displayName || form.name,
        industry: form.industry,
        businessType: form.businessType as 'proprietorship',
        gstin: form.gstin || undefined,
        address: {
          line1: form.addressLine1,
          city: form.city,
          state: form.state,
          pincode: form.pincode,
          country: 'India',
        },
        contact: {
          phone: form.phone,
          email: form.email,
        },
      };
      const company = await createCompany(payload);
      setCurrentCompany(company);
      toast.success('Company created');
      router.push('/companies');
    } catch {
      // toast from context
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ title: 'Companies', href: '/companies' }, { title: 'Add Company' }]} />

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Add Company</h1>
        <p className="mt-1 text-sm text-gray-600">Create a new company for your account.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6 space-y-6 max-w-2xl">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Company name *" name="name" value={form.name} onChange={handleChange} required />
          <Input label="Display name" name="displayName" value={form.displayName} onChange={handleChange} />
          <Input label="Industry *" name="industry" value={form.industry} onChange={handleChange} required />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Business type *</label>
            <select
              name="businessType"
              value={form.businessType}
              onChange={handleChange}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
            >
              <option value="proprietorship">Proprietorship</option>
              <option value="partnership">Partnership</option>
              <option value="llp">LLP</option>
              <option value="private_limited">Private Limited</option>
              <option value="other">Other</option>
            </select>
          </div>
          <Input label="GSTIN" name="gstin" value={form.gstin} onChange={handleChange} />
        </div>

        <div className="border-t pt-4">
          <h3 className="text-sm font-medium text-gray-900 mb-3">Address</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Address line 1 *" name="addressLine1" value={form.addressLine1} onChange={handleChange} required className="sm:col-span-2" />
            <Input label="City *" name="city" value={form.city} onChange={handleChange} required />
            <Input label="State *" name="state" value={form.state} onChange={handleChange} required />
            <Input label="Pincode *" name="pincode" value={form.pincode} onChange={handleChange} required />
          </div>
        </div>

        <div className="border-t pt-4">
          <h3 className="text-sm font-medium text-gray-900 mb-3">Contact</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Phone *" name="phone" value={form.phone} onChange={handleChange} required />
            <Input label="Email *" name="email" type="email" value={form.email} onChange={handleChange} required />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Company'}
          </Button>
          <Link href="/companies">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
