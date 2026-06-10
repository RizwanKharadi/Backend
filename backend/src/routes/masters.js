import express from 'express';
import { protect, checkCompanyAccess } from '../middleware/auth.js';
import { requireActiveSubscription } from '../middleware/license.js';
import {
  getVoucherTypes,
  getGodowns,
  getUnits,
  getAccountLedgers,
  getLedgers,
  getGstRegistrations
} from '../controllers/masterController.js';

const router = express.Router();

router.use(protect, requireActiveSubscription);

router.get('/voucher-types', checkCompanyAccess, getVoucherTypes);
router.get('/godowns', checkCompanyAccess, getGodowns);
router.get('/units', checkCompanyAccess, getUnits);
router.get('/account-ledgers', checkCompanyAccess, getAccountLedgers);
router.get('/ledgers', checkCompanyAccess, getLedgers);
router.get('/gst-registrations', checkCompanyAccess, getGstRegistrations);

export default router;
