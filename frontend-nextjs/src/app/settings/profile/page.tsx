'use client';

import React, { useState, useEffect } from 'react';
import SettingsShell from '@/components/settings/SettingsShell';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'react-hot-toast';

export default function ProfileSettingsPage() {
  const { user, updateProfile } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });

  useEffect(() => {
    if (user) {
      setForm({
        name: user.name || '',
        email: user.email || '',
        phone: user.phone || '',
      });
    }
  }, [user]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await updateProfile({ name: form.name, phone: form.phone });
      toast.success('Profile updated');
    } catch {
      // toast from context
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SettingsShell title="Profile Settings" description="Update your personal information.">
      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6 space-y-4 max-w-lg">
        <Input label="Name" name="name" value={form.name} onChange={handleChange} required />
        <Input label="Email" name="email" type="email" value={form.email} onChange={handleChange} disabled />
        <p className="text-xs text-gray-500 -mt-2">Email cannot be changed here.</p>
        <Input label="Phone" name="phone" value={form.phone} onChange={handleChange} />
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving...' : 'Save Changes'}
        </Button>
      </form>
    </SettingsShell>
  );
}
