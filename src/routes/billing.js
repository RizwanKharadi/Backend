import express from 'express';
import { body, validationResult } from 'express-validator';
import { protect } from '../middleware/auth.js';
import { MIN_SEATS, MAX_SEATS } from '../constants/billingPlans.js';
import {
  listPlans,
  getBillingStatus,
  createCheckout,
  syncSubscription,
  cancelSubscription,
  handleBillingWebhook
} from '../controllers/billingController.js';

const router = express.Router();

/** Public plan catalog */
router.get('/plans', listPlans);

/** Razorpay subscription webhooks (no JWT) */
router.post('/webhook', handleBillingWebhook);

router.use(protect);

/**
 * Billing routes use JWT only — not requireActiveSubscription —
 * so expired trials can still subscribe.
 */

router.get('/status', getBillingStatus);

router.post(
  '/subscribe',
  [
    body('billingCycle')
      .isIn(['monthly', 'yearly'])
      .withMessage('billingCycle must be monthly or yearly'),
    body('seatLimit')
      .isInt({ min: MIN_SEATS, max: MAX_SEATS })
      .withMessage(`seatLimit must be between ${MIN_SEATS} and ${MAX_SEATS}`)
  ],
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    return createCheckout(req, res, next);
  }
);

router.post('/sync', syncSubscription);

router.post('/cancel', cancelSubscription);

export default router;
