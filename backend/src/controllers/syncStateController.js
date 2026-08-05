/**
 * Visibility into records that are saved in the cloud but not yet in Tally.
 *
 * Registers deliberately exclude these so app figures reconcile with Tally
 * (see utils/syncStateFilter.js). That would hide them completely, so the app
 * needs a way to count and list them — otherwise a voucher that failed to
 * import just quietly disappears from the user's view.
 */
import { Voucher, Item, Party, TallyImportQueue } from '../models/index.js';
import logger from '../utils/logger.js';

// @desc    Counts of records saved in cloud but not yet in Tally
// @route   GET /api/tally/pending-sync?companyId=...
// @access  Private
export const getPendingSyncSummary = async (req, res) => {
  try {
    const company = req.company._id;
    const pending = { tallySynced: false };

    const [vouchers, items, parties, queued] = await Promise.all([
      Voucher.countDocuments({ company, ...pending }),
      Item.countDocuments({ company, isActive: true, ...pending }),
      Party.countDocuments({ company, isActive: true, ...pending }),
      TallyImportQueue.countDocuments({ company, status: 'pending' }),
    ]);

    // Rows the queue gave up on after MAX_ATTEMPTS — these need a human.
    const abandoned = await TallyImportQueue.countDocuments({
      company,
      status: 'failed',
    });

    res.status(200).json({
      success: true,
      data: {
        vouchers,
        items,
        parties,
        total: vouchers + items + parties,
        /** Still scheduled for automatic retry on the next agent connect. */
        queuedForRetry: queued,
        /** Exhausted retries — will not resolve on its own. */
        needsAttention: abandoned,
      },
    });
  } catch (error) {
    logger.error('Get pending sync summary error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    The queue rows themselves, newest first (for a pending-sync screen)
// @route   GET /api/tally/pending-sync/items?companyId=...
// @access  Private
export const getPendingSyncItems = async (req, res) => {
  try {
    const rows = await TallyImportQueue.find({
      company: req.company._id,
      status: { $in: ['pending', 'failed'] },
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.status(200).json({
      success: true,
      data: rows.map((r) => ({
        id: r._id,
        entityType: r.entityType,
        entityId: r.entityId,
        status: r.status,
        attempts: r.attempts,
        lastError: r.lastError,
        lastAttemptAt: r.lastAttemptAt,
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    logger.error('Get pending sync items error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
