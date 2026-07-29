import express from 'express';
import { body, validationResult } from 'express-validator';
import { protect } from '../middleware/auth.js';
import { requireActiveSubscription } from '../middleware/license.js';
import {
  activateDeviceHandler,
  licenseStatusHandler,
  agentLicenseStatusHandler,
  listDevicesHandler,
  revokeDeviceHandler
} from '../controllers/deviceController.js';

const router = express.Router();

// Agent heartbeat — optional device token; no subscription required to read status
router.get('/license-status/agent', agentLicenseStatusHandler);

router.use(protect);

router.post(
  '/activate',
  [
    body('agentId').trim().notEmpty().withMessage('agentId is required')
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
    return activateDeviceHandler(req, res, next);
  }
);

router.get('/license-status', licenseStatusHandler);
router.get('/', listDevicesHandler);
router.delete('/:agentId', revokeDeviceHandler);

export default router;
