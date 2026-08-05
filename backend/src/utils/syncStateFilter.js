/**
 * Keeps app registers reconcilable with Tally.
 *
 * A record created in the app that never reached Tally used to appear in the
 * lists and totals alongside real Tally data, so the app reported 4 vouchers
 * where Tally had 3 — and every figure became suspect. Records not yet in Tally
 * are held back from the register and surfaced in the pending-sync view instead.
 *
 * Default is "not explicitly pending" rather than "tallySynced === true" on
 * purpose: tallySynced is nullable, and filtering on `= true` would silently
 * hide any row where it was never set. Nothing disappears from a register
 * unless we positively marked it as not-in-Tally.
 */

/** @param syncState 'synced' (default) | 'pending' | 'all' */
export function syncStateClause(syncState) {
  const state = String(syncState || 'synced').toLowerCase();
  if (state === 'all') return null;
  if (state === 'pending') return { tallySynced: false };
  return { $or: [{ tallySynced: true }, { tallySynced: null }] };
}

/**
 * Add the clause via $and — these list queries already use $or for search, so
 * assigning $or here would clobber it.
 */
export function applySyncState(query, syncState) {
  const clause = syncStateClause(syncState);
  if (!clause) return query;
  query.$and = [...(query.$and || []), clause];
  return query;
}

export default { syncStateClause, applySyncState };
