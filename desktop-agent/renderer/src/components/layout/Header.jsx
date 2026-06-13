import React from 'react'
import {
  CogIcon,
  MinusIcon,
  WifiIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowLeftOnRectangleIcon
} from '@heroicons/react/24/outline'
import Button from '../common/Button'
import Badge from '../common/Badge'
import { ConnectionStatus } from '../../types'
import { useAppStore } from '../../stores/appStore'

const Header = ({
  connectionStatus = {},
  userEmail = '',
  onMinimize,
  onSettings,
  onLogout,
  onSubscription
}) => {
  const { subscriptionAccess } = useAppStore()
  const getConnectionIcon = (status) => {
    switch (status) {
      case ConnectionStatus.CONNECTED:
        return <CheckCircleIcon className="w-4 h-4 text-emerald-400" />
      case ConnectionStatus.CONNECTING:
        return <WifiIcon className="w-4 h-4 text-amber-400 animate-pulse" />
      case ConnectionStatus.ERROR:
        return <ExclamationTriangleIcon className="w-4 h-4 text-red-400" />
      default:
        return <WifiIcon className="w-4 h-4 text-slate-500" />
    }
  }

  const { server = ConnectionStatus.DISCONNECTED, tally = ConnectionStatus.DISCONNECTED } =
    connectionStatus

  const allConnected =
    server === ConnectionStatus.CONNECTED && tally === ConnectionStatus.CONNECTED

  const trialBlocked = subscriptionAccess && !subscriptionAccess.allowed

  return (
    <header className="flex-shrink-0 bg-white/90 backdrop-blur-md border-b border-slate-200/80 shadow-sm z-10">
      {trialBlocked && (
        <div className="px-5 py-2 bg-red-600 text-white text-xs font-medium text-center">
          {subscriptionAccess.displayMessage ||
            subscriptionAccess.reason ||
            'Error: Trial expired, purchase subscription to continue'}
          {onSubscription && (
            <button
              type="button"
              onClick={onSubscription}
              className="ml-2 underline font-semibold hover:text-red-100"
            >
              Subscribe
            </button>
          )}
        </div>
      )}
      <div className="h-[60px] px-5 flex items-center justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <h1 className="text-base font-semibold text-slate-800 truncate hidden sm:block">
            Tally → Cloud Sync
          </h1>
          <div className="flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 text-slate-600">
              {getConnectionIcon(server)}
              Server
            </span>
            <span className="inline-flex items-center gap-1.5 text-slate-600">
              {getConnectionIcon(tally)}
              Tally
            </span>
            <Badge
              variant={allConnected ? 'success' : 'secondary'}
              size="sm"
              className="!text-[11px]"
            >
              {allConnected ? 'Online' : 'Offline'}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {userEmail && (
            <div className="hidden md:flex items-center gap-3 pl-3 border-l border-slate-200">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-white">
                {userEmail.charAt(0).toUpperCase()}
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-slate-800 max-w-[180px] truncate">
                  {userEmail}
                </p>
                <button
                  type="button"
                  onClick={onLogout}
                  className="text-[11px] text-slate-500 hover:text-red-600 inline-flex items-center gap-1 transition-colors"
                >
                  <ArrowLeftOnRectangleIcon className="w-3.5 h-3.5" />
                  Sign out
                </button>
              </div>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            icon={CogIcon}
            onClick={onSettings}
            className="text-slate-600 hover:bg-slate-100"
            title="Settings"
          />
          <Button
            variant="ghost"
            size="sm"
            icon={MinusIcon}
            onClick={onMinimize}
            className="text-slate-600 hover:bg-slate-100"
            title="Minimize to Tray"
          />
        </div>
      </div>
    </header>
  )
}

export default Header
