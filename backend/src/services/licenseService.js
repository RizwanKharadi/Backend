import jwt from 'jsonwebtoken';
import Organization from '../models/Organization.js';
import Subscription from '../models/Subscription.js';
import DeviceLicense from '../models/DeviceLicense.js';
import User from '../models/User.js';
import {
  TRIAL_DAYS,
  TRIAL_SEAT_LIMIT,
  GRACE_PERIOD_DAYS,
  isLicenseEnforcementEnabled
} from '../constants/licensing.js';
import logger from '../utils/logger.js';

const msPerDay = 24 * 60 * 60 * 1000;

/**
 * @returns {{ allowed: boolean, status: string, reason?: string, subscription?: object, graceEndsAt?: Date }}
 */
export function evaluateSubscription(subscription) {
  if (!subscription) {
    return { allowed: false, status: 'none', reason: 'No subscription found' };
  }

  const now = new Date();

  if (subscription.status === 'suspended' || subscription.status === 'cancelled') {
    return {
      allowed: false,
      status: subscription.status,
      reason: `Subscription is ${subscription.status}`,
      subscription
    };
  }

  if (subscription.status === 'trial') {
    const trialEnd = subscription.trialEndsAt || subscription.currentPeriodEnd;
    if (trialEnd && trialEnd > now) {
      return { allowed: true, status: 'trial', subscription, trialEndsAt: trialEnd };
    }
    return {
      allowed: false,
      status: 'trial_expired',
      reason: 'Trial period has ended. Please subscribe to continue.',
      subscription,
      trialEndsAt: trialEnd
    };
  }

  if (subscription.status === 'past_due') {
    const failedAt = subscription.paymentFailedAt;
    if (failedAt) {
      const graceEndsAt = new Date(failedAt.getTime() + GRACE_PERIOD_DAYS * msPerDay);
      if (graceEndsAt > now) {
        return {
          allowed: true,
          status: 'past_due_grace',
          reason: 'Payment overdue — grace period active',
          subscription,
          graceEndsAt
        };
      }
    }
    return {
      allowed: false,
      status: 'past_due',
      reason: 'Payment overdue and grace period has ended.',
      subscription
    };
  }

  if (subscription.status === 'active') {
    if (subscription.currentPeriodEnd && subscription.currentPeriodEnd <= now) {
      return {
        allowed: false,
        status: 'expired',
        reason: 'Subscription period has ended.',
        subscription
      };
    }
    return { allowed: true, status: 'active', subscription };
  }

  return { allowed: false, status: 'unknown', reason: 'Invalid subscription state', subscription };
}

export async function getOrganizationSubscription(organizationId) {
  if (!organizationId) {
    return null;
  }
  return Subscription.findOne({ organization: organizationId });
}

export async function getOrganizationAccess(organizationId) {
  const subscription = await getOrganizationSubscription(organizationId);
  return evaluateSubscription(subscription);
}

export async function countActiveDevices(organizationId) {
  return DeviceLicense.countDocuments({
    organization: organizationId,
    status: 'active'
  });
}

/**
 * Create organization + trial subscription for a new customer.
 */
export async function createTrialOrganization({ name, billingEmail, createdBy }) {
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * msPerDay);

  const organization = await Organization.create({
    name,
    billingEmail,
    status: 'trial',
    createdBy,
    mobileIncluded: true
  });

  const subscription = await Subscription.create({
    organization: organization._id,
    planId: 'trial',
    billingCycle: 'trial',
    status: 'trial',
    seatLimit: TRIAL_SEAT_LIMIT,
    trialEndsAt,
    currentPeriodStart: new Date(),
    currentPeriodEnd: trialEndsAt
  });

  organization.subscription = subscription._id;
  await organization.save();

  return { organization, subscription };
}

/**
 * Ensure legacy users have an organization (lazy migration on login/API use).
 */
export async function ensureOrganizationForUser(user) {
  const orgId = user.organizationId;
  if (orgId) {
    return orgId;
  }

  const organization = await Organization.create({
    name: `${user.name}'s Organization`,
    billingEmail: user.email,
    status: 'trial',
    createdBy: user._id,
    mobileIncluded: true
  });

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * msPerDay);
  const subscription = await Subscription.create({
    organization: organization._id,
    planId: 'trial',
    billingCycle: 'trial',
    status: 'trial',
    seatLimit: TRIAL_SEAT_LIMIT,
    trialEndsAt,
    currentPeriodStart: new Date(),
    currentPeriodEnd: trialEndsAt
  });

  organization.subscription = subscription._id;
  await organization.save();

  await User.findByIdAndUpdate(user._id, { organizationId: organization._id });

  logger.info('Lazy-provisioned trial organization for user', {
    userId: user._id,
    organizationId: organization._id
  });

  return organization._id;
}

export function signDeviceToken(deviceLicense, organizationId) {
  return jwt.sign(
    {
      type: 'device',
      agentId: deviceLicense.agentId,
      organizationId: organizationId.toString(),
      deviceLicenseId: deviceLicense._id.toString()
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.DEVICE_TOKEN_EXPIRE || '30d' }
  );
}

export function verifyDeviceToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.type !== 'device' || !decoded.agentId) {
    throw new Error('Invalid device token');
  }
  return decoded;
}

/**
 * @returns {{ allowed: boolean, reason?: string, deviceLicense?: object, organizationId?: string }}
 */
export async function checkDeviceLicense(agentId) {
  if (!isLicenseEnforcementEnabled()) {
    return { allowed: true, reason: 'enforcement_disabled' };
  }

  if (!agentId) {
    return { allowed: false, reason: 'Missing agent ID' };
  }

  const deviceLicense = await DeviceLicense.findOne({ agentId });
  if (!deviceLicense) {
    return {
      allowed: false,
      reason: 'Device not activated. Activate this PC from the desktop agent after logging in.'
    };
  }

  if (deviceLicense.status === 'revoked') {
    return { allowed: false, reason: 'Device license has been revoked.' };
  }

  if (deviceLicense.status !== 'active') {
    return { allowed: false, reason: `Device license is ${deviceLicense.status}.` };
  }

  const access = await getOrganizationAccess(deviceLicense.organization);
  if (!access.allowed) {
    return {
      allowed: false,
      reason: access.reason || 'Organization subscription is not active.',
      organizationId: deviceLicense.organization
    };
  }

  deviceLicense.lastSeenAt = new Date();
  await deviceLicense.save();

  return {
    allowed: true,
    deviceLicense,
    organizationId: deviceLicense.organization,
    subscriptionStatus: access.status
  };
}

/**
 * Activate a desktop agent seat for the user's organization.
 */
export async function activateDevice({
  user,
  agentId,
  machineFingerprint,
  hostname,
  os,
  agentVersion
}) {
  const organizationId = await ensureOrganizationForUser(user);

  const subscription = await getOrganizationSubscription(organizationId);
  const access = evaluateSubscription(subscription);
  const enforcementEnabled = isLicenseEnforcementEnabled();

  if (enforcementEnabled && !access.allowed) {
    const err = new Error(access.reason || 'Subscription is not active');
    err.statusCode = 402;
    throw err;
  }

  const seatLimit = subscription?.seatLimit ?? TRIAL_SEAT_LIMIT;

  let deviceLicense = await DeviceLicense.findOne({ agentId });

  if (deviceLicense) {
    if (deviceLicense.organization.toString() !== organizationId.toString()) {
      const err = new Error('This device is registered to another organization');
      err.statusCode = 403;
      throw err;
    }
    if (deviceLicense.status === 'revoked') {
      if (enforcementEnabled) {
        const activeCount = await countActiveDevices(organizationId);
        if (activeCount >= seatLimit) {
          const err = new Error(
            `Device seat limit reached (${seatLimit}). Revoke another device or upgrade your plan.`
          );
          err.statusCode = 402;
          throw err;
        }
      }
      deviceLicense.status = 'active';
      deviceLicense.revokedAt = undefined;
      deviceLicense.revokeReason = undefined;
    }
    deviceLicense.lastSeenAt = new Date();
    if (machineFingerprint) deviceLicense.machineFingerprint = machineFingerprint;
    if (hostname) deviceLicense.hostname = hostname;
    if (os) deviceLicense.os = os;
    if (agentVersion) deviceLicense.agentVersion = agentVersion;
    await deviceLicense.save();
  } else {
    if (enforcementEnabled) {
      const activeCount = await countActiveDevices(organizationId);
      if (activeCount >= seatLimit) {
        const err = new Error(
          `Device seat limit reached (${seatLimit}). Revoke another device or upgrade your plan.`
        );
        err.statusCode = 402;
        throw err;
      }
    }

    deviceLicense = await DeviceLicense.create({
      organization: organizationId,
      agentId,
      status: 'active',
      machineFingerprint,
      hostname,
      os,
      agentVersion,
      activatedBy: user._id,
      activatedAt: new Date(),
      lastSeenAt: new Date()
    });
  }

  const deviceToken = signDeviceToken(deviceLicense, organizationId);

  return {
    deviceLicense,
    deviceToken,
    organizationId,
    seatLimit,
    seatsUsed: await countActiveDevices(organizationId),
    subscription: access
  };
}

export async function revokeDevice({ user, agentId, reason }) {
  const deviceLicense = await DeviceLicense.findOne({ agentId });
  if (!deviceLicense) {
    const err = new Error('Device not found');
    err.statusCode = 404;
    throw err;
  }

  if (user.role !== 'superadmin') {
    const organizationId = await ensureOrganizationForUser(user);
    if (deviceLicense.organization.toString() !== organizationId.toString()) {
      const err = new Error('Not authorized to revoke this device');
      err.statusCode = 403;
      throw err;
    }
  }

  deviceLicense.status = 'revoked';
  deviceLicense.revokedAt = new Date();
  deviceLicense.revokedBy = user._id;
  deviceLicense.revokeReason = reason || 'Revoked by administrator';
  await deviceLicense.save();

  return deviceLicense;
}

export async function listOrganizationDevices(user) {
  const organizationId = await ensureOrganizationForUser(user);
  return DeviceLicense.find({ organization: organizationId }).sort({ activatedAt: -1 });
}

export async function getLicenseStatusForUser(user, agentId) {
  const organizationId = await ensureOrganizationForUser(user);
  const subscription = await getOrganizationSubscription(organizationId);
  const access = evaluateSubscription(subscription);
  const seatsUsed = await countActiveDevices(organizationId);

  let device = null;
  if (agentId) {
    device = await DeviceLicense.findOne({ agentId, organization: organizationId });
  }

  return {
    organizationId,
    subscription: subscription
      ? {
          status: subscription.status,
          seatLimit: subscription.seatLimit,
          trialEndsAt: subscription.trialEndsAt,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          billingCycle: subscription.billingCycle,
          planId: subscription.planId
        }
      : null,
    access,
    seatsUsed,
    seatsAvailable: Math.max(0, (subscription?.seatLimit ?? 0) - seatsUsed),
    mobileIncluded: true,
    device: device
      ? {
          agentId: device.agentId,
          status: device.status,
          lastSeenAt: device.lastSeenAt,
          hostname: device.hostname
        }
      : null
  };
}

export { isLicenseEnforcementEnabled };
