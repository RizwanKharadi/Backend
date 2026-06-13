import React, { useState, useEffect } from 'react'
import {
  PlayIcon,
  StopIcon,
  ArrowPathIcon,
  ClockIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon
} from '@heroicons/react/24/outline'
import Card from '../components/common/Card'
import Button from '../components/common/Button'
import Badge from '../components/common/Badge'
import ProgressBar from '../components/common/ProgressBar'
import Checkbox from '../components/common/Checkbox'
import Select from '../components/common/Select'
import { useAppStore } from '../stores/appStore'
import toast from 'react-hot-toast'
import { useElectronAPI } from '../hooks/useElectronAPI'
import { SyncStatus as SyncStatusEnum, SyncIntervals, formatTimestamp, formatDuration, formatSyncError } from '../types'

const SyncStatus = () => {
  const {
    syncStatus,
    config,
    updateConfig,
    isSyncing,
    setCurrentPage
  } = useAppStore()

  const {
    startSync,
    stopSync,
    resetSyncState,
    setConfig,
    getOpenSyncCompaniesPreview
  } = useElectronAPI()
  const syncTypeLabels = {
    masters: 'Masters',
    parties: 'Parties & ledgers',
    vouchers: 'Vouchers',
    reports: 'Reports & Analytics',
    companies: 'Companies',
    done: 'Finishing'
  }

  const syncTypeHints = {
    masters: 'Stock items, godowns, voucher types, units',
    parties: 'All company ledgers (sundry debtors/creditors from parent group + chart)',
    vouchers: 'Sales, purchase, receipts, payments, etc.',
    reports: 'P&L, balance sheet, outstanding'
  }

  const SYNC_TYPE_ORDER = ['masters', 'parties', 'vouchers', 'reports']

  const buildSyncTypes = (syncTypes = {}) => {
    const legacyMasters =
      syncTypes.items !== false ||
      syncTypes.voucherTypes !== false ||
      syncTypes.godowns !== false ||
      syncTypes.units !== false
    const legacyParties = syncTypes.parties !== false || syncTypes.ledgers !== false

    return {
      masters:
        syncTypes.masters !== undefined ? syncTypes.masters !== false : legacyMasters,
      parties:
        syncTypes.parties !== undefined ? syncTypes.parties !== false : legacyParties,
      vouchers: syncTypes.vouchers !== false,
      reports: syncTypes.reports !== false,
      companies: false
    }
  }

  const toStoredSyncTypes = (groups) => ({
    masters: groups.masters,
    parties: groups.parties,
    vouchers: groups.vouchers,
    reports: groups.reports
  })

  const [localConfig, setLocalConfig] = useState({
    autoSync: config.sync.autoSync,
    syncInterval: config.sync.syncInterval,
    syncTypes: buildSyncTypes(config.sync?.syncTypes)
  })
  const [isStartingSync, setIsStartingSync] = useState(false)

  useEffect(() => {
    const normalized = buildSyncTypes(config.sync?.syncTypes)
    setLocalConfig((prev) => ({ ...prev, syncTypes: normalized }))
    if (config.sync?.syncTypes?.companies) {
      const withoutCompanies = { ...normalized }
      updateConfig('sync.syncTypes', withoutCompanies)
      setConfig({
        ...config,
        sync: { ...config.sync, syncTypes: withoutCompanies }
      }).catch(() => {})
    }
  }, [])

  const handleStartSync = async () => {
    if (isStartingSync || isSyncing()) return
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
      await startSync()
    } finally {
      setIsStartingSync(false)
    }
  }

  const handleStopSync = async () => {
    await stopSync()
  }

  const handleResetFullVoucherSync = async () => {
    if (isSyncing()) {
      return
    }
    const ok = window.confirm(
      'Clear voucher sync progress for all linked companies?\n\n' +
        'The next sync will re-fetch vouchers from each company\'s saved sync month/year (full sync), ' +
        'not just recent days.'
    )
    if (!ok) return
    await resetSyncState()
  }

  const handleConfigChange = async (key, value) => {
    const newConfig = { ...localConfig, [key]: value }
    setLocalConfig(newConfig)
    
    // Update the store and save to Electron
    updateConfig(`sync.${key}`, value)
    await setConfig({
      ...config,
      sync: {
        ...config.sync,
        [key]: value
      }
    })
  }

  const handleSyncTypeChange = async (type, enabled) => {
    if (type === 'companies') return
    const newSyncTypes = { ...buildSyncTypes(localConfig.syncTypes), [type]: enabled }
    const stored = toStoredSyncTypes(newSyncTypes)
    setLocalConfig({ ...localConfig, syncTypes: newSyncTypes })

    updateConfig('sync.syncTypes', stored)
    await setConfig({
      ...config,
      sync: {
        ...config.sync,
        syncTypes: stored
      }
    })
  }

  const getSyncStatusBadge = (status) => {
    switch (status) {
      case SyncStatusEnum.RUNNING:
        return <Badge variant="info">Running</Badge>
      case SyncStatusEnum.COMPLETED:
        return <Badge variant="success">Completed</Badge>
      case SyncStatusEnum.PARTIAL:
        return <Badge variant="warning">Partial</Badge>
      case SyncStatusEnum.FAILED:
        return <Badge variant="error">Failed</Badge>
      case SyncStatusEnum.PAUSED:
        return <Badge variant="warning">Paused</Badge>
      default:
        return <Badge variant="secondary">Idle</Badge>
    }
  }

  const getHistoryIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon className="w-5 h-5 text-success-500" />
      case 'partial':
        return <ExclamationTriangleIcon className="w-5 h-5 text-warning-500" />
      case 'failed':
        return <XCircleIcon className="w-5 h-5 text-error-500" />
      case 'running':
        return <ArrowPathIcon className="w-5 h-5 text-blue-500 animate-spin" />
      default:
        return <ClockIcon className="w-5 h-5 text-gray-400" />
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sync Status</h1>
        <p className="text-gray-600">
          Start sync manually here. Auto sync is off by default — enable it below (default: every hour).
        </p>
      </div>

      {/* Sync Configuration */}
      <Card
        title="Sync Configuration"
        actions={
          <div className="flex flex-wrap gap-2">
            {isSyncing() ? (
              <Button
                variant="error"
                icon={StopIcon}
                onClick={handleStopSync}
                size="sm"
              >
                Stop Sync
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  icon={PlayIcon}
                  onClick={handleStartSync}
                  loading={isStartingSync}
                  disabled={isStartingSync}
                  size="sm"
                >
                  Start Sync
                </Button>
                <Button
                  variant="outline"
                  icon={ArrowPathIcon}
                  onClick={handleResetFullVoucherSync}
                  size="sm"
                  title="Clear incremental voucher cursor"
                >
                  Full voucher sync
                </Button>
              </>
            )}
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <Checkbox
              label="Auto Sync Enabled"
              description="Automatically sync data at regular intervals"
              checked={localConfig.autoSync}
              onChange={(e) => handleConfigChange('autoSync', e.target.checked)}
            />

            <Select
              label="Sync Interval"
              value={localConfig.syncInterval}
              onChange={(e) => handleConfigChange('syncInterval', e.target.value)}
              options={SyncIntervals}
              disabled={!localConfig.autoSync}
            />
          </div>

          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-gray-900">Sync Types</h4>
              <p className="text-sm text-gray-500 mt-1">
                Vouchers, masters and reports. Link Tally companies from the{' '}
                <strong>Add Company</strong> page — not here.
              </p>
            </div>
            <div className="space-y-3">
              {SYNC_TYPE_ORDER.map((type) => (
                <div key={type}>
                  <Checkbox
                    label={syncTypeLabels[type]}
                    checked={Boolean(localConfig.syncTypes[type])}
                    onChange={(e) => handleSyncTypeChange(type, e.target.checked)}
                  />
                  {syncTypeHints[type] ? (
                    <p className="text-xs text-gray-500 ml-7 mt-0.5">{syncTypeHints[type]}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Current Sync Progress */}
      <Card title="Sync Progress">
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center space-x-3">
                <span className="text-sm font-medium text-gray-900">Status:</span>
                {getSyncStatusBadge(syncStatus.status)}
              </div>
              {syncStatus.currentOperation && (
                <span className="text-sm text-gray-700 sm:text-right sm:max-w-xl">
                  {syncStatus.currentOperation}
                </span>
              )}
            </div>

            {isSyncing() && (syncStatus.phaseKey || syncStatus.currentStage) && (
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">Current step</p>
                <p className="text-sm font-medium text-blue-900">
                  {syncStatus.phaseKey
                    ? (syncTypeLabels[syncStatus.phaseKey] || syncStatus.phaseKey)
                    : syncStatus.currentStage}
                  {typeof syncStatus.phaseIndex === 'number' &&
                    typeof syncStatus.phaseCount === 'number' &&
                    syncStatus.phaseCount > 0 && (
                    <span className="text-blue-700 font-normal">
                      {' '}
                      ({syncStatus.phaseIndex + 1} of {syncStatus.phaseCount} stages)
                    </span>
                  )}
                </p>
                {syncStatus.voucherWindow && (
                  <p className="mt-1 text-xs text-blue-800">
                    {syncStatus.companyName ? `${syncStatus.companyName} · ` : ''}
                    Fetching {syncStatus.voucherWindow.from} → {syncStatus.voucherWindow.to}
                    {' '}({syncStatus.voucherWindow.count} vouchers)
                    {syncStatus.voucherWindow.rangeFrom && (
                      <span className="text-blue-600">
                        {' '}· full range {syncStatus.voucherWindow.rangeFrom} → {syncStatus.voucherWindow.rangeTo}
                      </span>
                    )}
                  </p>
                )}
                {typeof syncStatus.etaMinutesRemaining === 'number' && (
                  <p className="mt-1 text-xs font-semibold text-blue-900">
                    {syncStatus.etaMinutesRemaining <= 1
                      ? 'Less than a minute left in this stage'
                      : `≈ ${syncStatus.etaMinutesRemaining} min left in this stage`}
                  </p>
                )}
              </div>
            )}

            {!isSyncing() && syncStatus.status === SyncStatusEnum.COMPLETED && (
              <div className="rounded-lg border border-green-100 bg-green-50 px-3 py-2">
                <p className="text-sm text-green-900">
                  {syncStatus.processedItems != null && syncStatus.totalItems != null
                    ? `${syncStatus.processedItems.toLocaleString()} rows synced to the cloud.`
                    : 'Last sync completed successfully.'}
                  {syncStatus.queuePending > 0 && (
                    <span className="block mt-1 text-green-800">
                      {syncStatus.queuePending} queued batch(es) still sending in the background.
                    </span>
                  )}
                </p>
              </div>
            )}

            {!isSyncing() && syncStatus.status === SyncStatusEnum.PARTIAL && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-sm text-amber-900">
                  Sync finished with errors. Voucher upload may be incomplete — run sync again to resume.
                  {syncStatus.processedItems != null && syncStatus.totalItems != null && (
                    <span className="block mt-1">
                      {syncStatus.processedItems.toLocaleString()} of {syncStatus.totalItems.toLocaleString()} rows uploaded before failure.
                    </span>
                  )}
                  {syncStatus.queuePending > 0 && (
                    <span className="block mt-1 text-amber-800">
                      {syncStatus.queuePending} queued batch(es) could not be sent.
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>

          {isSyncing() && (
            <div className="space-y-2">
              <ProgressBar
                value={typeof syncStatus.progress === 'number' ? syncStatus.progress : 0}
                max={100}
                size="lg"
                variant="primary"
                showLabel
                label={
                  syncStatus.processedItems != null && syncStatus.totalItems != null
                    ? `${syncStatus.progress ?? 0}% · ${syncStatus.processedItems} rows pushed${
                        typeof syncStatus.etaMinutesRemaining === 'number'
                          ? ` · ~${Math.max(1, syncStatus.etaMinutesRemaining)} min left`
                          : ''
                      }`
                    : `${syncStatus.progress ?? 0}% complete`
                }
                animated
              />
              <p className="text-xs text-gray-500">
                Progress is weighted across phases (vouchers → items → parties → reports). Row count includes every
                voucher, item, and party written to the server.
              </p>
            </div>
          )}

          {(syncStatus.errors || []).length > 0 && (
            <div className="bg-error-50 border border-error-200 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <ExclamationTriangleIcon className="w-5 h-5 text-error-500" />
                <span className="text-sm font-medium text-error-800">
                  Sync Errors ({(syncStatus.errors || []).length})
                </span>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {(syncStatus.errors || []).slice(0, 5).map((error, index) => (
                  <p key={index} className="text-sm text-error-700">
                    {formatSyncError(error)}
                  </p>
                ))}
                {(syncStatus.errors || []).length > 5 && (
                  <p className="text-sm text-error-600">
                    ... and {(syncStatus.errors || []).length - 5} more errors
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Sync History */}
      <Card title="Sync History">
        <div className="space-y-4">
          {syncStatus.history.length > 0 ? (
            <div className="space-y-3">
              {syncStatus.history.slice(0, 10).map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    {getHistoryIcon(session.status)}
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-gray-900">
                          Sync Session
                        </span>
                        {getSyncStatusBadge(session.status)}
                      </div>
                      <p className="text-xs text-gray-500">
                        {formatTimestamp(session.startTime)}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">
                      {session.processedItems}/{session.totalItems} items
                    </p>
                    <p className="text-xs text-gray-500">
                      {session.endTime && formatDuration(
                        new Date(session.endTime) - new Date(session.startTime)
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <ClockIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No sync history available</p>
              <p className="text-sm text-gray-400">Start a sync to see history here</p>
            </div>
          )}
        </div>
      </Card>

    </div>
  )
}

export default SyncStatus
