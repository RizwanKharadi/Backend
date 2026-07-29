'use client';

import React from 'react';
import SettingsShell from '@/components/settings/SettingsShell';

export default function NotificationsSettingsPage() {
  return (
    <SettingsShell
      title="Notifications"
      description="Notification preferences will be available in a future update."
    >
      <div className="bg-white shadow rounded-lg p-6 text-sm text-gray-600">
        Email, SMS, and push notification settings are not configured yet. Use the mobile app for
        push notifications when enabled.
      </div>
    </SettingsShell>
  );
}
