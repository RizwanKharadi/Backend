/**
 * Turns successive Bills Receivable / Bills Payable snapshots into payment history.
 *
 * Tally sends the full outstanding report on each sync and `outstandingreceivables`
 * keeps only the latest one. That answers "what is owed today" but loses the fact
 * that a bill existed at all once it is paid — so nothing downstream can learn how
 * a party actually pays. This module diffs each incoming snapshot against the
 * bills already on record: bills still present are refreshed, bills that have
 * disappeared are marked settled.
 *
 * Deliberately defensive, because a wrong `settled` mark is unrecoverable
 * (the bill is gone from Tally's report; nothing will contradict it later):
 *   - an empty snapshot never settles anything (a dropped/partial upload looks
 *     exactly like "everything got paid at once")
 *   - a snapshot older than what we have already processed is ignored entirely
 *   - bills with no bill reference are skipped; they have no stable identity
 */

import BillHistory from '../models/BillHistory.js';
import logger from '../utils/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_MAX = 191;

const normKey = (value) => String(value || '').trim().toLowerCase().slice(0, KEY_MAX);

/**
 * Bills identify their party by name, not id — Tally's outstanding report carries
 * no ids. Anything joining billhistory to parties has to normalise the same way,
 * so the rule lives here rather than being reimplemented per caller.
 */
export const normalisePartyKey = normKey;

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Flatten a snapshot's ledgers into a Map keyed by bill identity.
 * A party can legitimately carry the same ref twice (Tally allows it); we keep
 * one row and sum the balances rather than letting the second overwrite the first.
 */
function flattenSnapshot(ledgers) {
  const bills = new Map();

  for (const ledger of Array.isArray(ledgers) ? ledgers : []) {
    const partyName = String(ledger?.partyName || '').trim();
    if (!partyName) continue;

    for (const bill of Array.isArray(ledger?.bills) ? ledger.bills : []) {
      const billRef = String(bill?.billRef || '').trim();
      // "On Account" receipts and unreferenced adjustments have no identity we
      // can follow across snapshots — tracking them would create a new phantom
      // bill every sync.
      if (!billRef) continue;

      const partyKey = normKey(partyName);
      const billKey = normKey(billRef);
      const identity = `${partyKey}::${billKey}`;
      const balance = Math.abs(toNumber(bill?.closingBalance));

      const existing = bills.get(identity);
      if (existing) {
        existing.lastSeenBalance += balance;
        continue;
      }

      bills.set(identity, {
        partyName,
        billRef,
        partyKey,
        billKey,
        billDate: toDate(bill?.billDate),
        billDue: toDate(bill?.billDue),
        lastSeenBalance: balance,
        lastSeenOverdue: bill?.billOverdue != null ? Math.trunc(toNumber(bill.billOverdue)) : null,
        vchType: bill?.vchType || '',
        vchNumber: bill?.vchNumber || '',
      });
    }
  }

  return bills;
}

function daysBetween(later, earlier) {
  return Math.round((later.getTime() - earlier.getTime()) / DAY_MS);
}

/**
 * Record one outstanding-report snapshot.
 *
 * Must be called *before* the outstandingreceivables row is overwritten only in
 * the sense that it needs the incoming (not stored) ledgers; it reads its own
 * high-water mark from billhistory, so ordering against that write is not critical.
 *
 * Never throws — payment history is derived data, and failing to record it must
 * not fail the Tally sync that produced it.
 *
 * @returns {Promise<{tracked:number, created:number, settled:number, reopened:number, skipped?:string}>}
 */
export async function recordBillSnapshot({
  company,
  reportName = 'Bills Receivable',
  ledgers = [],
  asOfDate = new Date(),
} = {}) {
  const result = { tracked: 0, created: 0, settled: 0, reopened: 0 };

  try {
    const companyId = company != null ? String(company) : '';
    if (!companyId) return { ...result, skipped: 'no-company' };

    const stamp = toDate(asOfDate) || new Date();
    const snapshot = flattenSnapshot(ledgers);

    // A snapshot with no identifiable bills is indistinguishable from a partial
    // or failed upload. Settling every open bill on that basis would be wrong
    // and unrecoverable, so treat it as no information at all.
    if (snapshot.size === 0) {
      logger.info('Bill history: empty snapshot ignored', { company: companyId, reportName });
      return { ...result, skipped: 'empty-snapshot' };
    }

    const existingRows = await BillHistory.find({ company: companyId, reportName }).lean();

    // Reject snapshots that predate what we have already folded in — the desktop
    // agent can replay an older report after a reconnect, and rewinding would
    // resurrect settled bills and then re-settle them at the wrong dates.
    let highWater = null;
    for (const row of existingRows) {
      const seen = toDate(row.lastSeenAt);
      if (seen && (!highWater || seen > highWater)) highWater = seen;
    }
    if (highWater && stamp < highWater) {
      logger.info('Bill history: stale snapshot ignored', {
        company: companyId,
        reportName,
        asOfDate: stamp.toISOString(),
        lastProcessed: highWater.toISOString(),
      });
      return { ...result, skipped: 'stale-snapshot' };
    }

    const byIdentity = new Map(
      existingRows.map((row) => [`${row.partyKey}::${row.billKey}`, row])
    );

    const inserts = [];
    const updates = [];
    const touchedIds = [];

    for (const [identity, bill] of snapshot) {
      const row = byIdentity.get(identity);

      if (!row) {
        inserts.push({
          company: companyId,
          reportName,
          ...bill,
          originalAmount: bill.lastSeenBalance,
          firstSeenAt: stamp,
          lastSeenAt: stamp,
          settledAt: null,
          daysLate: null,
          status: 'open',
        });
        continue;
      }

      const changes = { lastSeenAt: stamp };

      // A settled bill reappearing means Tally was edited (payment reversed or
      // the bill re-raised). Reopen it rather than keeping a settlement that is
      // no longer true.
      if (row.status === 'settled') {
        changes.status = 'open';
        changes.settledAt = null;
        changes.daysLate = null;
        result.reopened += 1;
      }

      if (toNumber(row.lastSeenBalance) !== bill.lastSeenBalance) {
        changes.lastSeenBalance = bill.lastSeenBalance;
      }
      if (bill.lastSeenBalance > toNumber(row.originalAmount)) {
        changes.originalAmount = bill.lastSeenBalance;
      }
      if (row.lastSeenOverdue !== bill.lastSeenOverdue) {
        changes.lastSeenOverdue = bill.lastSeenOverdue;
      }
      // Due dates can be filled in later in Tally; keep ours current.
      const dueNow = toDate(row.billDue);
      if (bill.billDue && (!dueNow || dueNow.getTime() !== bill.billDue.getTime())) {
        changes.billDue = bill.billDue;
      }

      // Only worth a write of its own if something beyond the timestamp moved;
      // the rest are batched into a single statement below.
      if (Object.keys(changes).length > 1) {
        updates.push({ id: row.id, changes });
      } else {
        touchedIds.push(row.id);
      }
    }

    // Anything on record as open but absent from an authoritative snapshot has
    // left Tally's outstanding report — i.e. it was paid off.
    const settlements = [];
    for (const row of existingRows) {
      if (row.status !== 'open') continue;
      if (snapshot.has(`${row.partyKey}::${row.billKey}`)) continue;

      const billDue = toDate(row.billDue);
      settlements.push({
        id: row.id,
        changes: {
          status: 'settled',
          settledAt: stamp,
          lastSeenBalance: 0,
          daysLate: billDue ? daysBetween(stamp, billDue) : null,
        },
      });
    }

    if (inserts.length) {
      await BillHistory.insertMany(inserts);
      result.created = inserts.length;
    }

    // One statement for the common case: bill unchanged, just seen again.
    if (touchedIds.length) {
      await BillHistory.updateMany({ id: { $in: touchedIds } }, { $set: { lastSeenAt: stamp } });
    }

    for (const { id, changes } of updates) {
      await BillHistory.updateMany({ id }, { $set: changes });
    }

    for (const { id, changes } of settlements) {
      await BillHistory.updateMany({ id }, { $set: changes });
    }
    result.settled = settlements.length;
    result.tracked = snapshot.size;

    if (result.created || result.settled || result.reopened) {
      logger.info('Bill history updated', {
        company: companyId,
        reportName,
        asOfDate: stamp.toISOString(),
        ...result,
      });
    }

    return result;
  } catch (error) {
    logger.warn('Bill history: failed to record snapshot', {
      company: company != null ? String(company) : null,
      reportName,
      error: error.message,
    });
    return { ...result, skipped: 'error' };
  }
}

/**
 * Payment behaviour per party, built from settled bills.
 *
 * This is the feature store the risk and payment-delay endpoints will read in
 * later phases. Returns a Map keyed by partyKey so callers can join on the
 * normalised name.
 *
 * `confidence` reflects how much history backs the numbers, not how late the
 * party is — callers should degrade their wording when it is low rather than
 * presenting a number built on two bills as fact.
 */
export async function getPartyPaymentBehaviour({
  company,
  reportName = 'Bills Receivable',
  sinceDays = 730,
} = {}) {
  const companyId = company != null ? String(company) : '';
  if (!companyId) return new Map();

  const since = new Date(Date.now() - sinceDays * DAY_MS);
  const rows = await BillHistory.find({
    company: companyId,
    reportName,
    status: 'settled',
    settledAt: { $gte: since },
  }).lean();

  const byParty = new Map();

  for (const row of rows) {
    if (row.daysLate == null) continue;

    let stats = byParty.get(row.partyKey);
    if (!stats) {
      stats = {
        partyName: row.partyName,
        partyKey: row.partyKey,
        settledCount: 0,
        lateCount: 0,
        delays: [],
        totalSettled: 0,
      };
      byParty.set(row.partyKey, stats);
    }

    stats.settledCount += 1;
    stats.totalSettled += toNumber(row.originalAmount);
    stats.delays.push(row.daysLate);
    if (row.daysLate > 0) stats.lateCount += 1;
  }

  for (const stats of byParty.values()) {
    const sorted = [...stats.delays].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    stats.lateRatio = stats.settledCount ? stats.lateCount / stats.settledCount : 0;
    stats.medianDaysLate =
      sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    stats.avgDaysLate = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
    stats.worstDaysLate = sorted[sorted.length - 1];
    // Full weight needs ~10 settled bills; below 3 the numbers are anecdotes.
    stats.confidence = Math.min(1, stats.settledCount / 10);
    delete stats.delays;
  }

  return byParty;
}

export default { recordBillSnapshot, getPartyPaymentBehaviour };
