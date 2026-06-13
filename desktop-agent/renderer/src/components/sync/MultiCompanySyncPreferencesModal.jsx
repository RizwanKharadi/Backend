import React, { useMemo, useState } from 'react'
import { PlayIcon } from '@heroicons/react/24/outline'
import Select from '../common/Select'
import Button from '../common/Button'
import { COMMON_TIMEZONES } from '../../constants/timezones'
import {
  MONTH_OPTIONS,
  buildYearOptions,
  getDefaultSyncPreferences
} from '../../utils/syncPreferencesDefaults'

/**
 * Set sync start (timezone + month/year) for several companies before a full-agent sync.
 */
const MultiCompanySyncPreferencesModal = ({ companies, onCancel, onConfirm, saving }) => {
  const yearOptions = useMemo(() => buildYearOptions(), [])

  const [rows, setRows] = useState(() =>
    (companies || []).map((c) => {
      const d = getDefaultSyncPreferences(c.booksFrom, c)
      return {
        tallyGuid: c.tallyGuid,
        tallyName: c.tallyName,
        timezone: d.timezone,
        month: d.month,
        year: d.year
      }
    })
  )

  const setRow = (index, patch) => {
    setRows((r) => r.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const handleSubmit = async () => {
    const payloads = rows.map((row) => ({
      tallyGuid: row.tallyGuid,
      tallyName: row.tallyName,
      timezone: row.timezone,
      month: row.month,
      year: row.year
    }))
    await onConfirm(payloads)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4 border border-gray-200 my-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="multi-sync-prefs-title"
      >
        <h2 id="multi-sync-prefs-title" className="text-lg font-semibold text-gray-900">
          Sync start date
        </h2>
        <p className="text-sm text-gray-600">
          Set timezone and the month/year to start syncing from for each company (first day of that
          month). Required before the first full sync.
        </p>

        <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-1">
          {rows.map((row, idx) => (
            <div key={row.tallyGuid || idx} className="border border-gray-100 rounded-lg p-4 space-y-3">
              <p className="font-medium text-gray-900">{row.tallyName}</p>
              <Select
                label="Timezone *"
                fullWidth
                value={row.timezone}
                onChange={(e) => setRow(idx, { timezone: e.target.value })}
                options={COMMON_TIMEZONES.map((t) => ({ value: t.value, label: t.label }))}
              />
              <Select
                label="Sync From Month *"
                fullWidth
                value={String(row.month)}
                onChange={(e) => setRow(idx, { month: Number(e.target.value) })}
                options={MONTH_OPTIONS.map((m) => ({ value: String(m.value), label: m.label }))}
              />
              <Select
                label="Sync From Year *"
                fullWidth
                value={String(row.year)}
                onChange={(e) => setRow(idx, { year: Number(e.target.value) })}
                options={yearOptions.map((y) => ({ value: String(y.value), label: y.label }))}
              />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            icon={PlayIcon}
            loading={saving}
            onClick={handleSubmit}
          >
            Start sync
          </Button>
        </div>
      </div>
    </div>
  )
}

export default MultiCompanySyncPreferencesModal
