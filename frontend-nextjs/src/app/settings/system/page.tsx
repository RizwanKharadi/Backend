'use client';

import React from 'react';
import SettingsShell from '@/components/settings/SettingsShell';

export default function SystemSettingsPage() {
  return (
    <SettingsShell title="System Settings" description="Application preferences.">
      <div className="bg-white shadow rounded-lg p-6 space-y-2 text-sm text-gray-600">
        <p>
          <span className="font-medium text-gray-900">API:</span>{' '}
          {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'}
        </p>
        <p>Theme and locale options will be added in a future release.</p>
      </div>
    </SettingsShell>
  );
}
