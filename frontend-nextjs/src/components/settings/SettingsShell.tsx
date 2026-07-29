'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

interface SettingsShellProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export default function SettingsShell({ title, description, children }: SettingsShellProps) {
  return (
    <div className="space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeftIcon className="h-4 w-4 mr-1" />
        Back to Settings
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {description && <p className="mt-2 text-sm text-gray-600">{description}</p>}
      </div>
      {children}
    </div>
  );
}
