/**
 * Durable retry queue for app-created records that could not reach Tally.
 *
 * Creating a ledger / stock item / voucher pushes it to the desktop agent over
 * the WebSocket synchronously. If the agent is not connected at that instant —
 * and the agent socket has been observed flapping on a 60s cycle — the push
 * fails, the record stays in the cloud, and nothing ever retries it. Customers
 * see "Saved" and the record silently never appears in Tally.
 *
 * Every failed push is recorded here and replayed when an agent connects for
 * that company.
 */
import { TallyImportQueue, Party, Item, Voucher } from '../models/index.js';
import logger from '../utils/logger.js';

/** entityType -> how to push it and how to mark the source row synced. */
const HANDLERS = {
  ledger: {
    push: (svc, company, payload, entityId) =>
      svc.pushLedgerToTally(company, payload, { partyId: entityId }),
    markSynced: (entityId, result) =>
      Party.findByIdAndUpdate(entityId, {
        'tallySync.synced': true,
        'tallySync.tallyId': result.tallyGuid,
        'tallySync.lastSyncDate': new Date(),
        'tallySync.syncError': '',
      }),
  },
  'stock-item': {
    push: (svc, company, payload, entityId) =>
      svc.pushStockItemToTally(company, payload, { itemId: entityId }),
    markSynced: (entityId, result) =>
      Item.findByIdAndUpdate(entityId, {
        'tallySync.synced': true,
        'tallySync.tallyId': result.tallyGuid,
        'tallySync.lastSyncDate': new Date(),
        'tallySync.syncError': '',
      }),
  },
  voucher: {
    push: (svc, company, payload, entityId) =>
      svc.pushVoucherToTally(company, payload, { voucherId: entityId }),
    markSynced: (entityId, result) =>
      Voucher.findByIdAndUpdate(entityId, {
        'tallySync.synced': true,
        'tallySync.tallyId': result.tallyGuid,
        'tallySync.lastSyncDate': new Date(),
        'tallySync.syncError': '',
      }),
  },
};

const MAX_ATTEMPTS = 10;

/**
 * Record a failed push so it can be replayed later. Never throws — a queueing
 * problem must not turn a successful cloud save into a 500.
 */
export async function enqueueFailedImport({
  companyId,
  entityType,
  entityId,
  payload,
  error,
  createdBy,
}) {
  if (!HANDLERS[entityType]) {
    logger.warn('Refusing to queue unknown Tally import type', { entityType });
    return null;
  }
  try {
    const existing = await TallyImportQueue.findOne({ entityType, entityId });
    if (existing) {
      // Same record failing again (e.g. user retried) — keep one row.
      await TallyImportQueue.findByIdAndUpdate(existing._id, {
        payload,
        status: 'pending',
        lastError: String(error || '').slice(0, 1000),
        lastAttemptAt: new Date(),
      });
      return existing._id;
    }

    const row = await TallyImportQueue.create({
      company: String(companyId),
      entityType,
      entityId: String(entityId),
      payload,
      status: 'pending',
      attempts: 0,
      lastError: String(error || '').slice(0, 1000),
      lastAttemptAt: new Date(),
      createdBy: createdBy ? String(createdBy) : null,
    });
    logger.info('Queued Tally import for retry', { entityType, entityId });
    return row?._id;
  } catch (e) {
    logger.error('Failed to queue Tally import', {
      entityType,
      entityId,
      error: e.message,
    });
    return null;
  }
}

/**
 * Replay everything pending for a company. Called when an agent connects.
 * Runs serially: the agent pushes one import at a time into Tally, and parallel
 * WebSocket traffic is what caused the 1006 drops this queue exists to survive.
 */
export async function flushPendingImports(company, wsService) {
  const companyId = company?._id?.toString?.() || String(company?._id || '');
  if (!companyId) return { attempted: 0, succeeded: 0, failed: 0 };

  let rows = [];
  try {
    rows = await TallyImportQueue.find({ company: companyId, status: 'pending' })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();
  } catch (e) {
    logger.error('Could not read Tally import queue', { error: e.message });
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  if (!rows.length) return { attempted: 0, succeeded: 0, failed: 0 };

  logger.info('Flushing queued Tally imports', { companyId, count: rows.length });

  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    const handler = HANDLERS[row.entityType];
    if (!handler) continue;

    try {
      const result = await handler.push(wsService, company, row.payload, row.entityId);

      const confirmed =
        Boolean(result?.tallyGuid) ||
        Boolean(result?.alreadyExisted) ||
        Number(result?.created) > 0 ||
        Number(result?.altered) > 0;

      if (!confirmed) {
        throw new Error('Tally did not confirm the import');
      }

      await handler.markSynced(row.entityId, result);
      await TallyImportQueue.findByIdAndUpdate(row._id, {
        status: 'done',
        attempts: (row.attempts || 0) + 1,
        lastError: '',
        lastAttemptAt: new Date(),
      });
      succeeded += 1;
    } catch (e) {
      const attempts = (row.attempts || 0) + 1;
      // Give up eventually so a permanently broken payload (bad ledger name,
      // missing item) does not retry forever on every reconnect.
      await TallyImportQueue.findByIdAndUpdate(row._id, {
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        attempts,
        lastError: String(e.message || e).slice(0, 1000),
        lastAttemptAt: new Date(),
      });
      failed += 1;
      logger.warn('Queued Tally import still failing', {
        entityType: row.entityType,
        entityId: row.entityId,
        attempts,
        error: e.message,
      });
      // Agent went away again — stop; the next connect will resume.
      if (String(e.message || '').includes('not connected')) break;
    }
  }

  logger.info('Tally import queue flush complete', {
    companyId,
    attempted: rows.length,
    succeeded,
    failed,
  });
  return { attempted: rows.length, succeeded, failed };
}

export default { enqueueFailedImport, flushPendingImports };
