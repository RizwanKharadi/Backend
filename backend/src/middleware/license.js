import {
  ensureOrganizationForUser,
  getOrganizationAccess,
  isLicenseEnforcementEnabled
} from '../services/licenseService.js';
import logger from '../utils/logger.js';

/**
 * Blocks API access when the user's organization subscription is not active.
 * Superadmin bypass. Mobile access is included with org subscription.
 */
export const requireActiveSubscription = async (req, res, next) => {
  try {
    if (!isLicenseEnforcementEnabled()) {
      return next();
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized'
      });
    }

    if (req.user.role === 'superadmin') {
      return next();
    }

    const organizationId = await ensureOrganizationForUser(req.user);
    const access = await getOrganizationAccess(organizationId);

    if (!access.allowed) {
      return res.status(402).json({
        success: false,
        message: access.reason || 'Subscription required',
        code: 'SUBSCRIPTION_INACTIVE',
        status: access.status,
        trialEndsAt: access.trialEndsAt,
        graceEndsAt: access.graceEndsAt
      });
    }

    req.organizationId = organizationId;
    req.subscriptionAccess = access;
    next();
  } catch (error) {
    logger.error('License middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error checking subscription'
    });
  }
};
