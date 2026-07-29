import express from 'express';
import { body, validationResult } from 'express-validator';
import { protect } from '../middleware/auth.js';
import {
  checkTallySerialInUse,
  registerTallySerial,
  mapTallyLicensePayload
} from '../services/tallySerialService.js';
import { ensureOrganizationForUser } from '../services/licenseService.js';
import logger from '../utils/logger.js';

const router = express.Router();

router.use(protect);

/**
 * Check whether a Tally serial is already linked to another account.
 * @route POST /api/tally-serial/check
 */
router.post(
  '/check',
  [body('serialNumber').trim().notEmpty().withMessage('serialNumber is required')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const result = await checkTallySerialInUse(req.body.serialNumber, req.user._id);

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('tally-serial check error:', error);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

/**
 * Register / refresh Tally serial for the logged-in user (e.g. after Tally connects).
 * @route POST /api/tally-serial/register
 */
router.post(
  '/register',
  [body('serialNumber').optional().trim(), body('tallyLicense').optional().isObject()],
  async (req, res) => {
    try {
      const license = mapTallyLicensePayload(req.body.tallyLicense) || {
        serialNumber: req.body.serialNumber,
        ...req.body.tallyLicense
      };

      if (!license?.serialNumber) {
        return res.status(400).json({
          success: false,
          message: 'Tally serial number is required'
        });
      }

      const organizationId = await ensureOrganizationForUser(req.user);

      const doc = await registerTallySerial({
        serialNumber: license.serialNumber,
        userId: req.user._id,
        organizationId,
        email: req.user.email,
        licenseDetails: license
      });

      return res.status(200).json({
        success: true,
        message: 'Tally serial registered',
        data: { id: doc._id, serialNumber: doc.serialNumber }
      });
    } catch (error) {
      logger.error('tally-serial register error:', error);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

export default router;
