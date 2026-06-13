import React, { useState, useEffect } from 'react'
import {
  BuildingOffice2Icon,
  ArrowPathIcon,
  PencilSquareIcon,
  TrashIcon
} from '@heroicons/react/24/outline'
import Card from '../components/common/Card'
import Button from '../components/common/Button'
import Badge from '../components/common/Badge'
import CompanySyncPreferencesModal from '../components/sync/CompanySyncPreferencesModal'
import { useAppStore } from '../stores/appStore'
import { useElectronAPI } from '../hooks/useElectronAPI'
import { getDefaultSyncPreferences } from '../utils/syncPreferencesDefaults'
import toast from 'react-hot-toast'

const MyCompanies = () => {
  const { config, appState, setCurrentPage } = useAppStore()
  const {
    fetchBackendCompanies,
    getTallyCompanies,
    getSyncCompaniesPreview,
    setCompanySyncPreferences,
    unlinkTallyCompany
  } = useElectronAPI()
  const [backendCompanies, setBackendCompanies] = useState([])
  const [loading, setLoading] = useState(false)
  const [removingId, setRemovingId] = useState(null)
  const [prefsModal, setPrefsModal] = useState(null)
  const [savingPrefs, setSavingPrefs] = useState(false)

  const linkedCompanies = config?.server?.linkedCompanies || []
  const tallyCompanies = appState?.tallyCompanies || []

  const isOpenInTally = (entry) =>
    tallyCompanies.some(
      (t) =>
        String(t.guid || '').trim() === String(entry.tallyGuid || '').trim() ||
        t.name === entry.tallyName
    )

  const loadCompanies = async () => {
    setLoading(true)
    try {
      const list = await fetchBackendCompanies()
      setBackendCompanies(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCompanies()
  }, [])

  const openEditPrefs = async (entry) => {
    const preview = await getSyncCompaniesPreview()
    const row = preview.find(
      (p) =>
        String(p.tallyGuid || '').trim() === String(entry.tallyGuid || '').trim() ||
        p.tallyName === entry.tallyName
    )
    const tallyList = await getTallyCompanies()
    const match = (tallyList || []).find(
      (t) =>
        String(t.guid || '').trim() === String(entry.tallyGuid || '').trim() ||
        t.name === entry.tallyName
    )
    const d = getDefaultSyncPreferences(match?.booksFrom, row || {})
    setPrefsModal({
      entry,
      timezone: d.timezone,
      month: d.month,
      year: d.year
    })
  }

  const savePrefsOnly = async (payload) => {
    const companyName = prefsModal?.entry?.tallyName || 'company'
    setSavingPrefs(true)
    try {
      const res = await setCompanySyncPreferences({
        ...payload,
        cloudCompanyId: prefsModal?.entry?.cloudCompanyId || payload.cloudCompanyId
      })
      if (!res?.success) {
        toast.error(res?.message || 'Could not save sync preferences')
        return
      }
      setPrefsModal(null)
      toast.success(`Sync start updated for ${companyName}`)
    } finally {
      setSavingPrefs(false)
    }
  }

  const handleRemoveCompany = async (entry) => {
    const ok = window.confirm(
      `Remove "${entry.tallyName}" from this agent?\n\nThis unlinks the company locally. Synced data in the cloud is kept but the company is deactivated on the server.`
    )
    if (!ok) return

    setRemovingId(entry.cloudCompanyId)
    try {
      const result = await unlinkTallyCompany(entry)
      if (result?.success) {
        toast.success(`Removed "${entry.tallyName}"`)
        await loadCompanies()
      }
    } finally {
      setRemovingId(null)
    }
  }

  const displayList = linkedCompanies.length > 0
    ? linkedCompanies
    : backendCompanies.map((c) => ({
        tallyName: c.name || c.displayName,
        tallyGuid: c.tallyIntegration?.companyPath || '',
        cloudCompanyId: String(c._id || c.id || ''),
        linkedAt: c.updatedAt || c.createdAt
      }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Companies</h1>
          <p className="text-gray-600">Tally companies linked to your account</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            icon={ArrowPathIcon}
            onClick={loadCompanies}
            loading={loading}
            size="sm"
          >
            Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCurrentPage('add-company')}>
            Add Company
          </Button>
        </div>
      </div>

      {displayList.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <BuildingOffice2Icon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600 font-medium">No companies linked yet</p>
            <p className="text-sm text-gray-500 mt-1 mb-4">
              Open a company in Tally and add it from the Add Company page.
            </p>
            <Button variant="primary" onClick={() => setCurrentPage('add-company')}>
              Add your first company
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4">
          {displayList.map((entry) => (
            <div
              key={entry.cloudCompanyId || entry.tallyGuid}
              className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between gap-4 shadow-sm"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 bg-primary-50 rounded-lg">
                  <BuildingOffice2Icon className="w-6 h-6 text-primary-600" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{entry.tallyName}</p>
                  {entry.linkedAt && (
                    <p className="text-xs text-gray-500">
                      Linked {new Date(entry.linkedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
                {isOpenInTally(entry) ? (
                  <Badge variant="success">Open in Tally</Badge>
                ) : (
                  <Badge variant="secondary">Linked</Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  icon={PencilSquareIcon}
                  onClick={() => openEditPrefs(entry)}
                >
                  Edit sync start
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setCurrentPage('sync')}
                >
                  Sync Status
                </Button>
                <Button
                  variant="error"
                  size="sm"
                  icon={TrashIcon}
                  loading={removingId === entry.cloudCompanyId}
                  onClick={() => handleRemoveCompany(entry)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {prefsModal && (
        <CompanySyncPreferencesModal
          companyName={prefsModal.entry.tallyName}
          tallyGuid={prefsModal.entry.tallyGuid}
          tallyNameForSave={prefsModal.entry.tallyName}
          initialTimezone={prefsModal.timezone}
          initialMonth={prefsModal.month}
          initialYear={prefsModal.year}
          saving={savingPrefs}
          doneLabel="Save"
          hideAddMore
          subtitle="Update when you need to change the historical sync range."
          onCancel={() => {
            if (!savingPrefs) setPrefsModal(null)
          }}
          onDone={savePrefsOnly}
          onAddMore={savePrefsOnly}
        />
      )}
    </div>
  )
}

export default MyCompanies
