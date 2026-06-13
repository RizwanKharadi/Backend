/**
 * Shared Tally XML/string helpers (used by legacy accounting import XML and mappers).
 */

function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatYyyyMmDd(value) {
  if (!value) return '';
  const asString = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
  const isoMatch = asString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}${month}${day}`;
  }
  const compact = asString.replace(/\D/g, '');
  if (compact.length === 8) return compact;
  return asString;
}

function yesNo(value) {
  return value ? 'Yes' : 'No';
}

function formatQty(qty, unit = 'Nos') {
  const n = Number(qty) || 0;
  const u = String(unit || 'Nos').trim() || 'Nos';
  return ` ${n.toFixed(3)} ${u}`;
}

function formatRate(rate, unit = 'Nos') {
  const n = Number(rate) || 0;
  const u = String(unit || 'Nos').trim() || 'Nos';
  return `${n.toFixed(2)}/${u}`;
}

function isPurchaseMode(mode) {
  return String(mode || '').includes('purchase');
}

function formatSignedAmount(amount, purchase) {
  const n = Math.abs(Number(amount) || 0);
  return purchase ? -n : n;
}

module.exports = {
  escapeXml,
  formatYyyyMmDd,
  yesNo,
  formatQty,
  formatRate,
  isPurchaseMode,
  formatSignedAmount
};
