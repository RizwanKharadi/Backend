'use client';

import React, { useState } from 'react';
import SettingsShell from '@/components/settings/SettingsShell';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';
import { authService } from '@/services/authService';
import { toast } from 'react-hot-toast';

export default function SecuritySettingsPage() {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (form.newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    try {
      await authService.changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      toast.success('Password updated');
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to change password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SettingsShell title="Security" description="Change your account password.">
      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6 space-y-4 max-w-lg">
        <Input
          label="Current password"
          name="currentPassword"
          type="password"
          value={form.currentPassword}
          onChange={handleChange}
          required
        />
        <Input
          label="New password"
          name="newPassword"
          type="password"
          value={form.newPassword}
          onChange={handleChange}
          required
        />
        <Input
          label="Confirm new password"
          name="confirmPassword"
          type="password"
          value={form.confirmPassword}
          onChange={handleChange}
          required
        />
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Updating...' : 'Update Password'}
        </Button>
      </form>
    </SettingsShell>
  );
}
