/**
 * Whether a Tally ledger parent group is Sundry Debtors / Creditors (party ledgers).
 */
export function isSundryPartyParent(parent) {
  const p = String(parent || '').toLowerCase();
  if (!p) return false;
  return (
    p.includes('sundry debtor') ||
    p.includes('sundry creditor') ||
    p === 'debtors' ||
    p === 'creditors' ||
    (p.includes('debtor') && !p.includes('duties')) ||
    (p.includes('creditor') && !p.includes('duties'))
  );
}

export function normalizeParentGroup(parent) {
  return String(parent || '').trim();
}

export function matchesAccountLedgerParent(parentGroup, expectedParent) {
  const parent = normalizeParentGroup(parentGroup).toLowerCase();
  const expected = normalizeParentGroup(expectedParent).toLowerCase();
  if (!expected) return false;
  return parent === expected || parent.includes(expected);
}
