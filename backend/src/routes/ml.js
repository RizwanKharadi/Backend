/**
 * Insights API — the endpoints the mobile app calls as `/ml/api/v1/*`.
 *
 * This replaces the FastAPI microservice that used to sit behind an unauthenticated
 * proxy on port 8001. That service read a MongoDB the backend no longer uses, and
 * none of its queries filtered by company, so every response mixed all tenants
 * together. Serving the same paths from inside the backend means requests arrive
 * already authenticated, and company scoping is enforced in one place here rather
 * than trusted to each handler.
 *
 * The route surface matches mobile's mlService.ts exactly, so the client needs no
 * changes. Handlers that are not built yet answer 501 with a stable envelope —
 * never a placeholder number, because a plausible-looking figure that nobody can
 * reconcile against Tally is worse than an empty state.
 */

import express from 'express';
import { protect } from '../middleware/auth.js';
import Company from '../models/Company.js';
import BillHistory from '../models/BillHistory.js';
import OutstandingReceivable from '../models/OutstandingReceivable.js';
import Voucher from '../models/Voucher.js';
import logger from '../utils/logger.js';

const router = express.Router();

const DAY_MS = 24 * 60 * 60 * 1000;

// Payment behaviour only becomes meaningful once enough bills have been settled
// and observed. Below this the endpoint reports itself as still collecting.
const MIN_SETTLED_BILLS = 20;
const MIN_HISTORY_DAYS = 30;

/**
 * Resolve which company this request is about.
 *
 * Mobile does not send a companyId on insights calls, so an explicit id is
 * honoured when given and otherwise we fall back to the user's first active
 * company. Either way `req.mlCompanyId` is set before any handler runs, and every
 * query downstream must filter on it.
 */
async function resolveCompany(req, res, next) {
  try {
    const requested = req.query?.companyId || req.body?.companyId;
    const memberships = Array.isArray(req.user?.companies) ? req.user.companies : [];
    const isSuperadmin = req.user?.role === 'superadmin';

    let companyId = null;

    if (requested) {
      const id = String(requested);
      const viaUserDoc = memberships.some(
        (c) => String(c?._id) === id && c?.isActive !== false
      );

      let allowed = viaUserDoc || isSuperadmin;
      if (!allowed) {
        const membership = await Company.findOne({
          _id: id,
          isActive: true,
          'users.user': req.user._id,
        }).select('_id');
        allowed = !!membership;
      }

      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to access this company',
        });
      }
      companyId = id;
    } else {
      const active = memberships.find((c) => c?.isActive !== false) || memberships[0];
      companyId = active?._id != null ? String(active._id) : null;
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        code: 'no_company',
        message: 'No company selected. Pass companyId, or select a company first.',
      });
    }

    req.mlCompanyId = companyId;
    next();
  } catch (error) {
    logger.error('Insights company resolution failed', { error: error.message });
    return res.status(500).json({ success: false, message: 'Failed to resolve company' });
  }
}

/**
 * How much of the data each feature depends on actually exists yet.
 *
 * Read by /models/status and /health/detailed. Every figure is counted from the
 * tenant's own rows — there is no global model and no shared training set, so one
 * customer's history never informs another's numbers.
 */
async function getDataReadiness(companyId) {
  const yearAgo = new Date(Date.now() - 365 * DAY_MS);

  const [settledBills, openBills, salesVouchers, outstanding, earliest] = await Promise.all([
    BillHistory.countDocuments({ company: companyId, status: 'settled' }),
    BillHistory.countDocuments({ company: companyId, status: 'open' }),
    Voucher.countDocuments({
      company: companyId,
      voucherType: { $in: ['sales', 'Sales'] },
      date: { $gte: yearAgo },
    }),
    OutstandingReceivable.findOne({ company: companyId, reportName: 'Bills Receivable' })
      .select('asOfDate totalOutstanding')
      .lean(),
    BillHistory.find({ company: companyId }).sort('firstSeenAt').limit(1).lean(),
  ]);

  const firstSeen = earliest?.[0]?.firstSeenAt ? new Date(earliest[0].firstSeenAt) : null;
  const historyDays = firstSeen ? Math.floor((Date.now() - firstSeen.getTime()) / DAY_MS) : 0;

  return {
    settledBills,
    openBills,
    salesVouchers,
    historyDays,
    lastOutstandingSync: outstanding?.asOfDate || null,
    totalOutstanding: outstanding?.totalOutstanding ?? null,
  };
}

/** Shape readiness into the ModelStatus contract mobile already types. */
function toModelStatus(readiness) {
  const paymentReady =
    readiness.settledBills >= MIN_SETTLED_BILLS && readiness.historyDays >= MIN_HISTORY_DAYS;

  const models = {
    payment_delay_predictor: {
      status: paymentReady ? 'active' : 'collecting_data',
      last_trained: null,
      // Deliberately null rather than a number: nothing has been measured yet, and
      // a made-up accuracy is what made the old service untrustworthy. Mobile
      // already renders null as "N/A".
      accuracy: null,
      version: 'rules-v1',
      readiness: Math.min(1, readiness.settledBills / MIN_SETTLED_BILLS),
      sample_size: readiness.settledBills,
      message: paymentReady
        ? `Based on ${readiness.settledBills} settled bills.`
        : `Needs ${MIN_SETTLED_BILLS} settled bills to be reliable — ${readiness.settledBills} so far.`,
    },
    risk_assessment: {
      status: readiness.openBills > 0 ? 'active' : 'collecting_data',
      last_trained: null,
      accuracy: null,
      version: 'rules-v1',
      readiness: readiness.openBills > 0 ? 1 : 0,
      sample_size: readiness.openBills,
      message:
        readiness.openBills > 0
          ? `Tracking ${readiness.openBills} open bills.`
          : 'Waiting for an outstanding report from Tally.',
    },
    inventory_forecast: {
      status: readiness.salesVouchers > 0 ? 'active' : 'collecting_data',
      last_trained: null,
      accuracy: null,
      version: 'rules-v1',
      readiness: Math.min(1, readiness.salesVouchers / 100),
      sample_size: readiness.salesVouchers,
      message:
        readiness.salesVouchers > 0
          ? `Based on ${readiness.salesVouchers} sales vouchers in the last year.`
          : 'No sales vouchers synced in the last year.',
    },
  };

  const statuses = Object.values(models).map((m) => m.status);
  const overall_health = statuses.every((s) => s === 'active')
    ? 'healthy'
    : statuses.every((s) => s !== 'active')
      ? 'collecting_data'
      : 'partial';

  return { models, overall_health };
}

/**
 * Placeholder for handlers landing in later phases. Answers a clear, machine
 * readable 501 rather than inventing data.
 */
const notImplemented = (feature) => (req, res) =>
  res.status(501).json({
    success: false,
    code: 'not_implemented',
    feature,
    message: `${feature} is not available yet.`,
  });

router.use(protect);
router.use(resolveCompany);

router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'TallyFin Insights',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

router.get('/health/detailed', async (req, res) => {
  try {
    const readiness = await getDataReadiness(req.mlCompanyId);
    res.json({
      status: 'healthy',
      service: 'TallyFin Insights',
      version: '1.0.0',
      company: req.mlCompanyId,
      data: readiness,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Insights detailed health failed', { error: error.message });
    res.status(503).json({ status: 'degraded', message: 'Could not read insight data' });
  }
});

router.get('/models/status', async (req, res) => {
  try {
    const readiness = await getDataReadiness(req.mlCompanyId);
    res.json(toModelStatus(readiness));
  } catch (error) {
    logger.error('Insights model status failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to read insight status' });
  }
});

router.post('/models/retrain', async (req, res) => {
  // Nothing is trained today — scores are computed from current data on request.
  // Kept so the existing mobile button reports honestly instead of erroring.
  try {
    const readiness = await getDataReadiness(req.mlCompanyId);
    res.json({
      message: 'Insights are recalculated from live data on every request.',
      ...toModelStatus(readiness),
    });
  } catch (error) {
    logger.error('Insights retrain failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to refresh insights' });
  }
});

// Built in later phases — registered now so the surface is fixed and the client
// gets a predictable answer instead of a 404 or a proxy timeout.
router.post('/payment-delay', notImplemented('Payment delay prediction'));
router.post('/payment-delay/bulk', notImplemented('Bulk payment delay prediction'));
router.post('/inventory-forecast', notImplemented('Inventory forecast'));
router.post('/risk-assessment', notImplemented('Risk assessment'));
router.get('/business-metrics', notImplemented('Business metrics'));
router.get('/customer-insights/:customerId', notImplemented('Customer insights'));
router.get('/inventory-analytics', notImplemented('Inventory analytics'));
router.get('/payment-trends', notImplemented('Payment trends'));
router.get('/risk-dashboard', notImplemented('Risk dashboard'));

router.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `No insights endpoint at ${req.originalUrl}`,
  });
});

export default router;
