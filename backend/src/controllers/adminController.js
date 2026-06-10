import Organization from '../models/Organization.js';
import Subscription from '../models/Subscription.js';
import DeviceLicense from '../models/DeviceLicense.js';
import User from '../models/User.js';
import { TRIAL_DAYS, TRIAL_SEAT_LIMIT } from '../constants/licensing.js';
import {
  evaluateSubscription,
  revokeDevice,
  transferDevice
} from '../services/licenseService.js';
import logger from '../utils/logger.js';

const msPerDay = 24 * 60 * 60 * 1000;

export const getOverview = async (req, res) => {
  try {
    const [
      orgCount,
      activeSubs,
      trialSubs,
      pastDueSubs,
      deviceCount,
      activeDevices
    ] = await Promise.all([
      Organization.countDocuments(),
      Subscription.countDocuments({ status: 'active' }),
      Subscription.countDocuments({ status: 'trial' }),
      Subscription.countDocuments({ status: 'past_due' }),
      DeviceLicense.countDocuments(),
      DeviceLicense.countDocuments({ status: 'active' })
    ]);

    res.status(200).json({
      success: true,
      data: {
        organizations: orgCount,
        subscriptions: {
          active: activeSubs,
          trial: trialSubs,
          past_due: pastDueSubs
        },
        devices: {
          total: deviceCount,
          active: activeDevices
        }
      }
    });
  } catch (error) {
    logger.error('Admin overview error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const listOrganizations = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);
    const skip = (page - 1) * limit;
    const status = req.query.status;

    const filter = {};
    if (status) {
      filter.status = status;
    }

    const [organizations, total] = await Promise.all([
      Organization.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'name email')
        .lean(),
      Organization.countDocuments(filter)
    ]);

    const orgIds = organizations.map((o) => o._id);
    const subscriptions = await Subscription.find({ organization: { $in: orgIds } }).lean();
    const subByOrg = Object.fromEntries(
      subscriptions.map((s) => [s.organization.toString(), s])
    );

    const deviceCounts = await DeviceLicense.aggregate([
      { $match: { organization: { $in: orgIds } } },
      {
        $group: {
          _id: '$organization',
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } }
        }
      }
    ]);
    const devicesByOrg = Object.fromEntries(
      deviceCounts.map((d) => [d._id.toString(), d])
    );

    const data = organizations.map((org) => {
      const sub = subByOrg[org._id.toString()];
      const devices = devicesByOrg[org._id.toString()] || { total: 0, active: 0 };
      return {
        ...org,
        subscription: sub
          ? {
              status: sub.status,
              seatLimit: sub.seatLimit,
              billingCycle: sub.billingCycle,
              trialEndsAt: sub.trialEndsAt,
              currentPeriodEnd: sub.currentPeriodEnd,
              razorpaySubscriptionId: sub.razorpaySubscriptionId
            }
          : null,
        access: sub ? evaluateSubscription(sub) : null,
        devices
      };
    });

    res.status(200).json({
      success: true,
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    logger.error('Admin list organizations error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getOrganization = async (req, res) => {
  try {
    const organization = await Organization.findById(req.params.id)
      .populate('createdBy', 'name email phone');
    if (!organization) {
      return res.status(404).json({ success: false, message: 'Organization not found' });
    }

    const subscription = await Subscription.findOne({ organization: organization._id });
    const devices = await DeviceLicense.find({ organization: organization._id }).sort({
      activatedAt: -1
    });
    const users = await User.find({ organizationId: organization._id }).select(
      'name email role isActive lastLogin'
    );

    res.status(200).json({
      success: true,
      data: {
        organization,
        subscription,
        access: subscription ? evaluateSubscription(subscription) : null,
        devices,
        users
      }
    });
  } catch (error) {
    logger.error('Admin get organization error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateOrganizationSubscription = async (req, res) => {
  try {
    const { status, seatLimit, extendTrialDays, billingCycle } = req.body;
    const organization = await Organization.findById(req.params.id);
    if (!organization) {
      return res.status(404).json({ success: false, message: 'Organization not found' });
    }

    let subscription = await Subscription.findOne({ organization: organization._id });
    if (!subscription) {
      subscription = await Subscription.create({
        organization: organization._id,
        planId: 'trial',
        billingCycle: 'trial',
        status: 'trial',
        seatLimit: TRIAL_SEAT_LIMIT,
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * msPerDay)
      });
    }

    if (status) {
      subscription.status = status;
      organization.status = status === 'trial' ? 'trial' : status;
    }
    if (seatLimit !== undefined) {
      subscription.seatLimit = Math.max(1, parseInt(seatLimit, 10));
    }
    if (billingCycle && ['trial', 'monthly', 'yearly'].includes(billingCycle)) {
      subscription.billingCycle = billingCycle;
    }
    if (extendTrialDays) {
      const days = parseInt(extendTrialDays, 10);
      const base = subscription.trialEndsAt && subscription.trialEndsAt > new Date()
        ? subscription.trialEndsAt
        : new Date();
      subscription.trialEndsAt = new Date(base.getTime() + days * msPerDay);
      subscription.currentPeriodEnd = subscription.trialEndsAt;
      subscription.status = 'trial';
      organization.status = 'trial';
    }

    if (status === 'active') {
      subscription.paymentFailedAt = undefined;
    }

    await subscription.save();
    await organization.save();

    res.status(200).json({
      success: true,
      message: 'Subscription updated',
      data: { organization, subscription, access: evaluateSubscription(subscription) }
    });
  } catch (error) {
    logger.error('Admin update subscription error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

export const listDevices = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 30);
    const skip = (page - 1) * limit;
    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }
    if (req.query.organizationId) {
      filter.organization = req.query.organizationId;
    }

    const [devices, total] = await Promise.all([
      DeviceLicense.find(filter)
        .sort({ lastSeenAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('organization', 'name billingEmail status')
        .populate('activatedBy', 'name email')
        .lean(),
      DeviceLicense.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: devices,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    logger.error('Admin list devices error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const adminRevokeDevice = async (req, res) => {
  try {
    const device = await revokeDevice({
      user: req.user,
      agentId: req.params.agentId,
      reason: req.body.reason || 'Revoked by platform admin'
    });
    res.status(200).json({ success: true, data: device });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

export const adminTransferDevice = async (req, res) => {
  try {
    const { targetOrganizationId, reason } = req.body;

    if (!targetOrganizationId) {
      return res.status(400).json({
        success: false,
        message: 'targetOrganizationId is required'
      });
    }

    const result = await transferDevice({
      user: req.user,
      agentId: req.params.agentId,
      targetOrganizationId,
      reason
    });

    res.status(200).json({
      success: true,
      message: 'Device transferred successfully. User should sign in again on the desktop agent.',
      data: {
        agentId: result.deviceLicense.agentId,
        status: result.deviceLicense.status,
        hostname: result.deviceLicense.hostname,
        previousOrganizationId: result.previousOrganizationId,
        organizationId: result.organizationId,
        seatLimit: result.seatLimit,
        seatsUsed: result.seatsUsed
      }
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
};
