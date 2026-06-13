import React from 'react'
import clsx from 'clsx'
import tallyfinLogo from '../../assets/tallyfin-icon.png'
import FinnyMascot from '../common/FinnyMascot'
import {
  ChartBarIcon,
  ArrowPathIcon,
  ServerIcon,
  ComputerDesktopIcon,
  DocumentTextIcon,
  CogIcon,
  CreditCardIcon,
  BuildingOffice2Icon,
  PlusCircleIcon
} from '@heroicons/react/24/outline'

const primaryNavigation = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: ChartBarIcon,
    description: 'Overview and quick actions'
  },
  {
    id: 'add-company',
    label: 'Add Company',
    icon: PlusCircleIcon,
    description: 'Link a Tally company'
  },
  {
    id: 'my-companies',
    label: 'My Companies',
    icon: BuildingOffice2Icon,
    description: 'Connected Tally companies'
  },
  {
    id: 'sync',
    label: 'Sync Status',
    icon: ArrowPathIcon,
    description: 'Run and monitor sync'
  }
]

const secondaryNavigation = [
  {
    id: 'tally',
    label: 'Tally Connection',
    icon: ServerIcon,
    description: 'Tally host and port settings'
  },
  {
    id: 'system',
    label: 'System Monitor',
    icon: ComputerDesktopIcon,
    description: 'Performance monitoring'
  },
  {
    id: 'logs',
    label: 'Logs',
    icon: DocumentTextIcon,
    description: 'Application logs'
  },
  {
    id: 'subscription',
    label: 'Subscription',
    icon: CreditCardIcon,
    description: 'License and billing'
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: CogIcon,
    description: 'Application settings'
  }
]

const NavButton = ({ item, isActive, onPageChange }) => {
  const Icon = item.icon

  return (
    <button
      onClick={() => onPageChange(item.id)}
      className={clsx(
        'w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60',
        isActive
          ? 'bg-gradient-to-r from-primary-600/90 to-indigo-600/80 text-white shadow-lg shadow-primary-900/40'
          : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
      )}
      title={item.description}
    >
      <Icon
        className={clsx(
          'w-5 h-5 flex-shrink-0',
          isActive ? 'text-white' : 'text-slate-500'
        )}
      />
      <span className="truncate">{item.label}</span>
    </button>
  )
}

const Sidebar = ({ currentPage, onPageChange }) => {
  return (
    <aside className="w-[260px] flex flex-col bg-slate-900 text-slate-300 border-r border-slate-800/80 shadow-xl">
      <div className="px-5 py-5 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <img
            src={tallyfinLogo}
            alt="TallyFin"
            className="w-10 h-10 rounded-xl bg-white object-contain p-0.5 shadow-lg shadow-primary-500/30"
          />
          <div>
            <p className="text-sm font-bold text-white tracking-tight">TallyFin</p>
            <p className="text-[11px] text-green-300/80 font-medium">Har Hisaab Aasan Hai</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-slate-800/50 border border-slate-700/50 px-3 py-2.5">
          <FinnyMascot pose="pointing" size={52} />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white">Hi, I&apos;m Finny!</p>
            <p className="text-[11px] text-slate-400 leading-snug mt-0.5">
              Add companies, then run sync from Sync Status.
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
        {primaryNavigation.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            isActive={currentPage === item.id}
            onPageChange={onPageChange}
          />
        ))}

        <div className="my-3 border-t border-slate-800/80" />

        {secondaryNavigation.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            isActive={currentPage === item.id}
            onPageChange={onPageChange}
          />
        ))}
      </nav>

      <div className="px-5 py-4 border-t border-slate-800/80">
        <p className="text-[10px] uppercase tracking-wider text-slate-600 font-semibold">Version</p>
        <p className="text-xs text-slate-500 mt-0.5">1.0.6 · Tally sync</p>
      </div>
    </aside>
  )
}

export default Sidebar
