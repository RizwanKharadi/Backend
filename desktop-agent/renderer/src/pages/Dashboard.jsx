import React, { useEffect, useState } from 'react'
import {
  ArrowPathIcon,
  ServerIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  QueueListIcon,
  PlayIcon,
  WrenchScrewdriverIcon,
  DocumentTextIcon
} from '@heroicons/react/24/outline'
import Card from '../components/common/Card'
import Button from '../components/common/Button'
import Badge from '../components/common/Badge'
import { useAppStore } from '../stores/appStore'
import { useElectronAPI } from '../hooks/useElectronAPI'
import { ConnectionStatus, formatRelativeTime } from '../types'
import toast from 'react-hot-toast'

const Dashboard = () => {
  const {
    connectionStatus,
    syncStatus,
    appState,
    config,
    getRecentActivity,
    setCurrentPage
  } = useAppStore()

  const {
    startSync,
    testTallyConnection,
    showNotification,
    getOpenSyncCompaniesPreview,
    getSyncStatus
  } = useElectronAPI()
  const [offlineQueueSize, setOfflineQueueSize] = useState(0)
  const [isStartingSync, setIsStartingSync] = useState(false)

  const recentActivity = getRecentActivity(5)

  useEffect(() => {
    const refreshQueue = async () => {
      const st = await getSyncStatus()
      if (st && typeof st.offlineQueueSize === 'number') {
        setOfflineQueueSize(st.offlineQueueSize)
      }
    }
    refreshQueue()
    const timer = setInterval(refreshQueue, 15000)
    return () => clearInterval(timer)
  }, [getSyncStatus])

  const handleForceSync = async () => {
    if (isStartingSync) return
    setIsStartingSync(true)
    try {
      const preview = await getOpenSyncCompaniesPreview()
      if (preview.length === 0) {
        toast.error('Open a linked company in Tally before starting sync')
        setCurrentPage('add-company')
        return
      }
      const missing = preview.filter((row) => !row.hasCompletePrefs)
      if (missing.length > 0) {
        const names = missing.map((row) => row.tallyName).filter(Boolean).join(', ')
        toast.error(
          names
            ? `Set sync start date in Add Company for: ${names}`
            : 'Set sync start date in Add Company before starting sync'
        )
        setCurrentPage('add-company')
        return
      }
      const success = await startSync()
      if (success) {
        showNotification('Sync Started', 'Manual synchronization has been initiated')
      }
    } finally {
      setIsStartingSync(false)
    }
  }

  const handleTestConnection = async () => {
    await testTallyConnection()
  }

  const getConnectionStatusBadge = (status) => {
    switch (status) {
      case ConnectionStatus.CONNECTED:
        return <Badge variant="success">Connected</Badge>
      case ConnectionStatus.CONNECTING:
        return <Badge variant="warning">Connecting</Badge>
      case ConnectionStatus.ERROR:
        return <Badge variant="error">Error</Badge>
      default:
        return <Badge variant="secondary">Disconnected</Badge>
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-primary-600 via-primary-600 to-indigo-700 p-6 text-white shadow-lg shadow-primary-500/20">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-primary-100/90 text-sm mt-1">
          Monitor sync health, connections, and recent activity
        </p>
      </div>

      {config?.server?.token && !(config?.server?.linkedCompanies || []).length && !String(config?.server?.companyId || '').trim() && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Link a Tally company</strong> to start syncing data to the cloud.
          <button
            type="button"
            className="ml-2 text-primary-700 font-medium underline"
            onClick={() => setCurrentPage('add-company')}
          >
            Add Company
          </button>
        </div>
      )}

      {/* Connection Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card
          title="TallyFin Server"
          className="hover:shadow-md transition-shadow"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-primary-100 rounded-lg">
                <ServerIcon className="w-6 h-6 text-primary-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Connection Status</p>
                {getConnectionStatusBadge(connectionStatus.server)}
                {connectionStatus.server !== ConnectionStatus.CONNECTED && connectionStatus.serverLastError && (
                  <p className="text-xs text-amber-700 mt-1 max-w-xs">
                    {connectionStatus.serverLastError}
                  </p>
                )}
              </div>
            </div>
            {connectionStatus.lastConnected && (
              <div className="text-right">
                <p className="text-xs text-gray-500">Last Connected</p>
                <p className="text-sm font-medium text-gray-900">
                  {formatRelativeTime(connectionStatus.lastConnected)}
                </p>
              </div>
            )}
          </div>
        </Card>

        <Card
          title="Tally ERP"
          className="hover:shadow-md transition-shadow"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-success-100 rounded-lg">
                <ServerIcon className="w-6 h-6 text-success-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Connection Status</p>
                {getConnectionStatusBadge(connectionStatus.tally)}
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Companies</p>
              <p className="text-sm font-medium text-gray-900">
                {appState.tallyCompanies.length}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Sync Statistics */}
      <Card title="Sync Statistics">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center">
            <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg mx-auto mb-3">
              <ClockIcon className="w-6 h-6 text-blue-600" />
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {syncStatus.lastSync ? formatRelativeTime(syncStatus.lastSync) : 'Never'}
            </p>
            <p className="text-sm text-gray-600">Last Sync</p>
          </div>

          <div className="text-center">
            <div className="flex items-center justify-center w-12 h-12 bg-green-100 rounded-lg mx-auto mb-3">
              <DocumentDuplicateIcon className="w-6 h-6 text-green-600" />
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {syncStatus.processedItems || 0}
            </p>
            <p className="text-sm text-gray-600">Items Synced</p>
          </div>

          <div className="text-center">
            <div className="flex items-center justify-center w-12 h-12 bg-yellow-100 rounded-lg mx-auto mb-3">
              <QueueListIcon className="w-6 h-6 text-yellow-600" />
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {offlineQueueSize}
            </p>
            <p className="text-sm text-gray-600">Offline queue (batches)</p>
          </div>
        </div>
      </Card>

      {/* Quick Actions */}
      <Card title="Quick Actions">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Button
            variant="primary"
            icon={PlayIcon}
            onClick={handleForceSync}
            loading={isStartingSync}
            disabled={syncStatus.status === 'running' || isStartingSync}
            fullWidth
          >
            Force Sync
          </Button>

          <Button
            variant="secondary"
            icon={WrenchScrewdriverIcon}
            onClick={handleTestConnection}
            fullWidth
          >
            Test Connection
          </Button>

          <Button
            variant="outline"
            icon={DocumentTextIcon}
            onClick={() => setCurrentPage('logs')}
            fullWidth
          >
            View Logs
          </Button>

          <Button
            variant="outline"
            icon={ArrowPathIcon}
            onClick={() => setCurrentPage('sync')}
            fullWidth
          >
            Sync Status
          </Button>
        </div>
      </Card>

      {/* Recent Activity */}
      <Card title="Recent Activity">
        <div className="space-y-4">
          {recentActivity.length > 0 ? (
            recentActivity.map((activity) => (
              <div key={activity.id} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-b-0">
                <div className="flex items-center space-x-3">
                  <div className={`w-2 h-2 rounded-full ${
                    activity.status === 'completed' || activity.status === 'success' ? 'bg-green-500' :
                    activity.status === 'failed' || activity.status === 'error' ? 'bg-red-500' :
                    activity.status === 'running' ? 'bg-blue-500' :
                    'bg-gray-400'
                  }`} />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{activity.message}</p>
                    <p className="text-xs text-gray-500">{activity.type}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">
                    {formatRelativeTime(activity.timestamp)}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500">No recent activity</p>
            </div>
          )}
        </div>
      </Card>

    </div>
  )
}

export default Dashboard
