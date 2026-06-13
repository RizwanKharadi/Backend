const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]

export const MONTH_OPTIONS = MONTH_LABELS.map((label, i) => ({
  value: i + 1,
  label
}))

export function buildYearOptions() {
  const y = new Date().getFullYear()
  const out = []
  for (let year = 2000; year <= y + 1; year += 1) {
    out.push({ value: year, label: String(year) })
  }
  return out
}

/**
 * @param {string} [booksFrom] - YYYY-MM-DD from Tally
 * @param {{ syncFromMonth?: number, syncFromYear?: number, syncTimezone?: string }} [saved]
 */
export function getDefaultSyncPreferences(booksFrom, saved = {}) {
  const timezone = saved.syncTimezone || 'Asia/Kolkata'
  if (saved.syncFromMonth && saved.syncFromYear) {
    return {
      timezone,
      month: saved.syncFromMonth,
      year: saved.syncFromYear
    }
  }
  if (booksFrom && /^\d{4}-\d{2}-\d{2}$/.test(booksFrom)) {
    const [ys, ms] = booksFrom.split('-')
    return {
      timezone,
      month: Number(ms),
      year: Number(ys)
    }
  }
  const now = new Date()
  return {
    timezone,
    month: now.getMonth() + 1,
    year: now.getFullYear()
  }
}
