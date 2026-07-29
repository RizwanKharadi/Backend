import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import {
  getOverview,
  listOrganizations,
  getOrganization,
  updateOrganizationSubscription,
  listDevices,
  adminRevokeDevice,
  adminTransferDevice
} from '../controllers/adminController.js';

const router = express.Router();

router.use(protect, authorize('superadmin'));

router.get('/overview', getOverview);
router.get('/organizations', listOrganizations);
router.get('/organizations/:id', getOrganization);
router.patch('/organizations/:id/subscription', updateOrganizationSubscription);
router.get('/devices', listDevices);
router.post('/devices/:agentId/transfer', adminTransferDevice);
router.delete('/devices/:agentId', adminRevokeDevice);

export default router;
