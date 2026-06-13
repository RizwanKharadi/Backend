import React, { useState, useEffect, useCallback } from 'react'
import { ArrowPathIcon, BuildingOffice2Icon, CalendarDaysIcon } from '@heroicons/react/24/outline'
import Button from '../components/common/Button'
import Badge from '../components/common/Badge'
import CompanySyncPreferencesModal from '../components/sync/CompanySyncPreferencesModal'
import { useAppStore } from '../stores/appStore'
import { useElectronAPI } from '../hooks/useElectronAPI'
import { ConnectionStatus } from '../types'
import { getDefaultSyncPreferences } from '../utils/syncPreferencesDefaults'
import toast from 'react-hot-toast'

const tallyCompanyKey = (company) => {
  if (!company) return ''
  const guid = company.guid != null ? String(company.guid).trim() : ''
  if (guid) return guid
  return company.name != null ? String(company.name).trim() : ''
}

const AddCompany = () => {
  const { connectionStatus, config, appState, setCurrentPage } = useAppStore()
  const {
    testTallyConnection,
    getTallyCompanies,
    linkTallyCompany,
    hydrateLinkedCompanies,
    setCompanySyncPreferences,
    getSyncCompaniesPreview
  } = useElectronAPI()

  const [isLoading, setIsLoading] = useState(false)
  const [linkingKey, setLinkingKey] = useState(null)
  const [prefsModal, setPrefsModal] = useState(null)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [syncPreview, setSyncPreview] = useState([])

  const linkedCompanies = config?.server?.linkedCompanies || []

  const refreshSyncPreview = useCallback(async () => {
    const preview = await getSyncCompaniesPreview()
    setSyncPreview(Array.isArray(preview) ? preview : [])
  }, [getSyncCompaniesPreview])

  const isLinked = useCallback(
    (company) => {
      const key = tallyCompanyKey(company)
      return linkedCompanies.some(
        (entry) => entry.tallyGuid === key || entry.tallyName === company?.name
      )
    },
    [linkedCompanies]
  )

  const needsSyncDate = useCallback(
    (entry) => {
      const row = syncPreview.find(
        (p) =>
          String(p.tallyGuid || '').trim() === String(entry.tallyGuid || '').trim() ||
          p.tallyName === entry.tallyName
      )
      return row ? !row.hasCompletePrefs : true
    },
    [syncPreview]
  )

  const loadTallyCompanies = useCallback(async () => {
    setIsLoading(true)
    try {
      if (connectionStatus.tally !== ConnectionStatus.CONNECTED) {
        await testTallyConnection()
      }
      await getTallyCompanies()
      await refreshSyncPreview()
    } finally {
      setIsLoading(false)
    }
  }, [connectionStatus.tally, testTallyConnection, getTallyCompanies, refreshSyncPreview])

  useEffect(() => {
    const init = async () => {
      await hydrateLinkedCompanies()
      await loadTallyCompanies()
    }
    init()
  }, [])

  const openPrefsForTallyCompany = (company, { alreadyLinked = false, cloudCompanyId = '' } = {}) => {
    const key = tallyCompanyKey(company)
    if (!key && !company?.name) {
      toast.error('Company has no name or GUID')
      return
    }
    const previewRow = syncPreview.find(
      (p) => p.tallyGuid === key || p.tallyName === company?.name
    )
    const d = getDefaultSyncPreferences(company?.booksFrom, previewRow || {})
    setPrefsModal({
      company,
      alreadyLinked,
      cloudCompanyId: cloudCompanyId || previewRow?.cloudCompanyId || '',
      tallyGuid: key,
      tallyName: company?.name || previewRow?.tallyName || '',
      timezone: d.timezone,
      month: d.month,
      year: d.year
    })
  }

  const handleAddCompanyClick = (company) => {
    if (isLinked(company)) {
      if (needsSyncDate({ tallyGuid: tallyCompanyKey(company), tallyName: company?.name })) {
        openPrefsForTallyCompany(company, { alreadyLinked: true })
      } else {
        toast.success('Company already linked with sync start date set.')
      }
      return
    }
    openPrefsForTallyCompany(company, { alreadyLinked: false })
  }

  const handlePrefsSave = async (payload) => {
    if (!prefsModal) return

    const key = prefsModal.tallyGuid || tallyCompanyKey(prefsModal.company)
    setSavingPrefs(true)
    setLinkingKey(key)

    try {
      if (!prefsModal.alreadyLinked) {
        const result = await linkTallyCompany(prefsModal.company)
        if (!result?.success) {
          return
        }
      }

      const res = await setCompanySyncPreferences({
        ...payload,
        tallyGuid: payload.tallyGuid || key,
        tallyName: payload.tallyName || prefsModal.tallyName,
        cloudCompanyId: prefsModal.cloudCompanyId || payload.cloudCompanyId
      })

      if (!res?.success) {
        toast.error(res?.message || 'Could not save sync start date')
        return
      }

      await refreshSyncPreview()
      setPrefsModal(null)
      toast.success(
        prefsModal.alreadyLinked
          ? `Sync start date saved for ${prefsModal.tallyName}.`
          : `"${prefsModal.tallyName}" linked. Open Sync Status to start sync.`,
        { duration: 6000 }
      )
    } finally {
      setSavingPrefs(false)
      setLinkingKey(null)
    }
  }

  const linkedNeedingSyncDate = linkedCompanies.filter((entry) => needsSyncDate(entry))

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Add Company</h1>
        <p className="text-gray-600 mt-1">
          Link a Tally company and set the <strong>sync start date</strong> here. Then run sync from{' '}
          <button
            type="button"
            onClick={() => setCurrentPage('sync')}
            className="text-primary-600 hover:text-primary-700 font-medium underline-offset-2 hover:underline"
          >
            Sync Status
          </button>
          .
        </p>
      </div>

      {linkedNeedingSyncDate.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <p className="text-sm font-medium text-amber-900">
            Sync start date required before first sync
          </p>
          <p className="text-xs text-amber-800">
            Only the company currently open in Tally is required to sync now. You can still set
            dates for other linked companies here to prepare them for later.
          </p>
          <ul className="space-y-2">
            {linkedNeedingSyncDate.map((entry) => (
              <li
                key={entry.cloudCompanyId || entry.tallyGuid}
                className="flex items-center justify-between gap-3 rounded-lg bg-white/80 border border-amber-100 px-3 py-2"
              >
                <span className="text-sm text-gray-900 font-medium">{entry.tallyName}</span>
                <Button
                  variant="outline"
                  size="sm"
                  icon={CalendarDaysIcon}
                  onClick={() => {
                    const match = appState.tallyCompanies.find(
                      (t) =>
                        tallyCompanyKey(t) === entry.tallyGuid || t.name === entry.tallyName
                    )
                    openPrefsForTallyCompany(
                      match || { name: entry.tallyName, guid: entry.tallyGuid },
                      { alreadyLinked: true, cloudCompanyId: entry.cloudCompanyId }
                    )
                  }}
                >
                  Set sync date
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <p className="text-xs font-semibold tracking-wider text-gray-500 uppercase">
            Tally Companies
          </p>
          <Button
            variant="ghost"
            size="sm"
            icon={ArrowPathIcon}
            onClick={loadTallyCompanies}
            loading={isLoading}
          >
            Refresh
          </Button>
        </div>

        <div className="p-6">
          {appState.tallyCompanies.length === 0 ? (
            <div className="text-center py-10">
              <BuildingOffice2Icon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">No company loaded in Tally</p>
              <p className="text-sm text-gray-500 mt-1">
                Open a company in Tally ERP, then click Refresh.
              </p>
              <Button
                variant="primary"
                className="mt-4"
                onClick={loadTallyCompanies}
                loading={isLoading}
              >
                Connect &amp; Refresh
              </Button>
            </div>
          ) : (
            <ul className="space-y-3">
              {appState.tallyCompanies.map((company, index) => {
                const key = tallyCompanyKey(company) || `company-${index}`
                const linked = isLinked(company)
                const missingSyncDate = linked && needsSyncDate({ tallyGuid: key, tallyName: company.name })
                return (
                  <li
                    key={key}
                    className="flex items-center justify-between gap-4 p-4 rounded-lg border border-gray-200 hover:border-gray-300 bg-gray-50/50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex-shrink-0 w-3 h-3 rounded-full bg-red-500 ring-4 ring-red-100" />
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{company.name}</p>
                        {company.booksFrom && (
                          <p className="text-xs text-gray-500 truncate">Books from {company.booksFrom}</p>
                        )}
                      </div>
                      {linked && !missingSyncDate && <Badge variant="success">Ready</Badge>}
                      {missingSyncDate && <Badge variant="warning">Set sync date</Badge>}
                    </div>
                    <Button
                      variant={linked && !missingSyncDate ? 'secondary' : 'primary'}
                      size="sm"
                      disabled={linkingKey === key}
                      loading={linkingKey === key}
                      onClick={() => handleAddCompanyClick(company)}
                    >
                      {linked ? (missingSyncDate ? 'Set sync date' : 'Linked') : '+ ADD'}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <p className="text-sm text-gray-500">
        Tip: To link another company, switch to it in Tally and press Refresh on this page.
      </p>

      {prefsModal && (
        <CompanySyncPreferencesModal
          companyName={prefsModal.tallyName}
          tallyGuid={prefsModal.tallyGuid}
          tallyNameForSave={prefsModal.tallyName}
          initialTimezone={prefsModal.timezone}
          initialMonth={prefsModal.month}
          initialYear={prefsModal.year}
          saving={savingPrefs}
          doneLabel={prefsModal.alreadyLinked ? 'Save' : 'Link company'}
          hideAddMore
          onCancel={() => {
            if (!savingPrefs) setPrefsModal(null)
          }}
          onDone={handlePrefsSave}
          onAddMore={handlePrefsSave}
        />
      )}
    </div>
  )
}

export default AddCompany
