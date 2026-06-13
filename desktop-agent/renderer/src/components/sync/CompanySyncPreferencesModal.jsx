import React, { useState } from 'react'
import { CheckIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline'
import Select from '../common/Select'
import Button from '../common/Button'
import { COMMON_TIMEZONES } from '../../constants/timezones'
import { MONTH_OPTIONS, buildYearOptions } from '../../utils/syncPreferencesDefaults'

/**
 * Per-company sync start: timezone + first day of selected month/year.
 * Matches desktop UI mockup (DONE = save + sync, ADD MORE = save only).
 */
const CompanySyncPreferencesModal = ({
  companyName,
  tallyGuid,
  tallyNameForSave,
  initialTimezone,
  initialMonth,
  initialYear,
  onDone,
  onAddMore,
  onCancel,
  saving = false,
  doneLabel = 'DONE',
  hideAddMore = false,
  subtitle = 'Set timezone and the month/year to start syncing from (first day of that month).'
}) => {
  const [timezone, setTimezone] = useState(initialTimezone || 'Asia/Kolkata')
  const [month, setMonth] = useState(initialMonth)
  const [year, setYear] = useState(initialYear)
  const yearOptions = buildYearOptions()

  const payload = () => ({
    tallyGuid: tallyGuid != null ? String(tallyGuid).trim() : '',
    tallyName: (tallyNameForSave || companyName || '').trim(),
    timezone,
    month: Number(month),
    year: Number(year)
  })

  const handleDone = async () => {
    await onDone(payload())
  }

  const handleAddMore = async () => {
    await onAddMore(payload())
  }

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && onCancel && !saving) {
      onCancel()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-5 border border-gray-200 relative"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-prefs-title"
      >
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="absolute top-4 right-4 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        )}

        <div className="pr-8">
          <h2 id="sync-prefs-title" className="text-lg font-semibold text-gray-900">
            Sync start date
          </h2>
          <p className="text-sm font-medium text-gray-800 mt-1">{companyName}</p>
          {subtitle ? <p className="text-sm text-gray-600 mt-1">{subtitle}</p> : null}
        </div>

        <Select
          label="Timezone *"
          fullWidth
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          options={COMMON_TIMEZONES.map((t) => ({ value: t.value, label: t.label }))}
        />

        <Select
          label="Sync From Month *"
          fullWidth
          value={String(month)}
          onChange={(e) => setMonth(Number(e.target.value))}
          options={MONTH_OPTIONS.map((m) => ({ value: String(m.value), label: m.label }))}
        />

        <Select
          label="Sync From Year *"
          fullWidth
          value={String(year)}
          onChange={(e) => setYear(Number(e.target.value))}
          options={yearOptions.map((y) => ({ value: String(y.value), label: y.label }))}
        />

        <p className="text-xs text-gray-500">
          Data sync starts from the first day of the selected month. Each company keeps its own settings.
        </p>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            icon={CheckIcon}
            loading={saving}
            onClick={handleDone}
          >
            {doneLabel}
          </Button>
          {!hideAddMore && (
            <Button
              type="button"
              variant="secondary"
              icon={PlusIcon}
              loading={saving}
              onClick={handleAddMore}
            >
              + ADD MORE
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default CompanySyncPreferencesModal
