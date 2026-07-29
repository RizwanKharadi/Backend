import crypto from 'crypto';
import Razorpay from 'razorpay';
import Organization from '../models/Organization.js';
import Subscription from '../models/Subscription.js';
import {
  BILLING_PLANS,
  getBillingPlan,
  listBillingPlans,
  MIN_SEATS,
  MAX_SEATS
} from '../constants/billingPlans.js';
import {
  ensureOrganizationForUser,
  getOrganizationSubscription,
  getLicenseStatusForUser,
  evaluateSubscription
} from './licenseService.js';
import logger from '../utils/logger.js';

const msPerDay = 24 * 60 * 60 * 1000;

/**
 * Razorpay statuses that grant sync/billing access in our DB.
 * Test/live checkouts often stay on `authenticated` briefly before `active`.
 */
export const RAZORPAY_PAID_STATUSES = new Set(['active', 'authenticated']);

/**
 * Whether a Razorpay subscription status should grant paid access in our DB.
 */
export function shouldActivatePaidSubscription(razorpayStatus) {
  return RAZORPAY_PAID_STATUSES.has(String(razorpayStatus || '').toLowerCase());
}

/**
 * Failed checkout payment must not downgrade an active trial.
 */
export function shouldMarkPastDueOnPaymentFailure(subscriptionStatus) {
  return subscriptionStatus === 'active' || subscriptionStatus === 'past_due';
}

/**
 * Map Razorpay SDK errors to clear API responses (avoid bare HTTP 401 for bad gateway keys).
 */
export function normalizeRazorpayError(error, context = 'Razorpay request') {
  const statusCode = error?.statusCode || error?.error?.statusCode;
  const description =
    error?.error?.description ||
    error?.error?.reason ||
    error?.message ||
    `${context} failed`;

  if (
    statusCode === 401 ||
    /authentication|invalid.*key|unauthorized/i.test(String(description))
  ) {
    const err = new Error(
      'Razorpay API authentication failed on the server. Set valid RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (Test keys with Test mode, Live with Live).'
    );
    err.statusCode = 503;
    err.code = 'RAZORPAY_AUTH_FAILED';
    return err;
  }

  if (/plan/i.test(description) && (statusCode === 400 || statusCode === 404)) {
    const err = new Error(
      `Razorpay plan error: ${description}. Check RAZORPAY_PLAN_MONTHLY_ID / RAZORPAY_PLAN_YEARLY_ID on the server match your Dashboard plans and mode (test/live).`
    );
    err.statusCode = 400;
    err.code = 'RAZORPAY_PLAN_INVALID';
    return err;
  }

  const err = new Error(`${context}: ${description}`);
  err.statusCode =
    statusCode && Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 600
      ? statusCode
      : 502;
  return err;
}

/** In-memory cache of Razorpay plan ids created at runtime */
const razorpayPlanIdCache = {
  monthly: process.env.RAZORPAY_PLAN_MONTHLY_ID || null,
  yearly: process.env.RAZORPAY_PLAN_YEARLY_ID || null
};

class SubscriptionBillingService {
  constructor() {
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      this.razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      });
    } else {
      this.razorpay = null;
    }
  }

  assertConfigured() {
    const keyId = process.env.RAZORPAY_KEY_ID || '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    if (!this.razorpay || !keyId || !keySecret) {
      const err = new Error('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
      err.statusCode = 503;
      throw err;
    }
    if (keyId.includes('your-razorpay') || keySecret.includes('your-razorpay')) {
      const err = new Error(
        'Razorpay is using placeholder keys. Set real RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the server.'
      );
      err.statusCode = 503;
      throw err;
    }
  }

  getPlans() {
    return listBillingPlans();
  }

  async getOrCreateRazorpayPlan(billingCycle) {
    this.assertConfigured();
    const planDef = getBillingPlan(billingCycle);
    if (!planDef) {
      throw new Error(`Invalid billing cycle: ${billingCycle}`);
    }

    if (razorpayPlanIdCache[billingCycle]) {
      return razorpayPlanIdCache[billingCycle];
    }

    try {
      const created = await this.razorpay.plans.create({
        period: planDef.period,
        interval: planDef.interval,
        item: {
          name: planDef.name,
          amount: planDef.unitAmountPaise,
          currency: 'INR',
          description: planDef.description
        },
        notes: {
          finsync_plan: billingCycle
        }
      });

      razorpayPlanIdCache[billingCycle] = created.id;
      logger.info('Created Razorpay plan', { billingCycle, planId: created.id });
      return created.id;
    } catch (error) {
      throw normalizeRazorpayError(error, 'Create Razorpay plan');
    }
  }

  /**
   * Start Razorpay subscription checkout (per-device quantity).
   */
  async createSubscriptionCheckout(user, { billingCycle, seatLimit }) {
    this.assertConfigured();

    const planDef = getBillingPlan(billingCycle);
    if (!planDef) {
      const err = new Error('billingCycle must be monthly or yearly');
      err.statusCode = 400;
      throw err;
    }

    const seats = parseInt(seatLimit, 10);
    if (!Number.isFinite(seats) || seats < MIN_SEATS || seats > MAX_SEATS) {
      const err = new Error(`seatLimit must be between ${MIN_SEATS} and ${MAX_SEATS}`);
      err.statusCode = 400;
      throw err;
    }

    const organizationId = await ensureOrganizationForUser(user);
    const organization = await Organization.findById(organizationId);
    let subscription = await getOrganizationSubscription(organizationId);

    if (!subscription) {
      const err = new Error('Subscription record not found for organization');
      err.statusCode = 404;
      throw err;
    }

    let razorpayPlanId;
    try {
      razorpayPlanId = await this.getOrCreateRazorpayPlan(billingCycle);
    } catch (error) {
      throw error.statusCode ? error : normalizeRazorpayError(error, 'Resolve Razorpay plan');
    }

    if (subscription.razorpaySubscriptionId) {
      try {
        const existing = await this.razorpay.subscriptions.fetch(subscription.razorpaySubscriptionId);
        if (['created', 'authenticated', 'pending'].includes(existing.status)) {
          await this.razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId, false);
        }
      } catch (cancelErr) {
        logger.warn('Could not cancel prior pending Razorpay subscription', {
          id: subscription.razorpaySubscriptionId,
          error: cancelErr.message
        });
      }
    }

    const totalCount = billingCycle === 'yearly' ? 10 : 120;

    const rzOptions = {
      plan_id: razorpayPlanId,
      quantity: seats,
      total_count: totalCount,
      customer_notify: 1,
      notify_info: {
        notify_phone: user.phone,
        notify_email: user.email
      },
      notes: {
        organizationId: organizationId.toString(),
        userId: user._id.toString(),
        billingCycle,
        seatLimit: String(seats),
        finsync_product: 'device_subscription'
      }
    };

    if (process.env.BILLING_CALLBACK_URL) {
      rzOptions.callback_url = process.env.BILLING_CALLBACK_URL;
    }

    let rzSubscription;
    try {
      rzSubscription = await this.razorpay.subscriptions.create(rzOptions);
    } catch (error) {
      logger.error('Razorpay subscriptions.create failed', {
        billingCycle,
        planId: razorpayPlanId,
        statusCode: error?.statusCode,
        description: error?.error?.description || error?.message
      });
      throw normalizeRazorpayError(error, 'Create Razorpay subscription checkout');
    }

    subscription.razorpaySubscriptionId = rzSubscription.id;
    subscription.razorpayPlanId = razorpayPlanId;
    subscription.pendingSeatLimit = seats;
    subscription.billingCycle = billingCycle;
    subscription.planId = planDef.id;
    subscription.notes = `Checkout started ${new Date().toISOString()}`;
    await subscription.save();

    logger.info('Razorpay subscription checkout created', {
      organizationId,
      razorpaySubscriptionId: rzSubscription.id,
      seats,
      billingCycle
    });

    return {
      razorpaySubscriptionId: rzSubscription.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      shortUrl: rzSubscription.short_url,
      status: rzSubscription.status,
      seatLimit: seats,
      billingCycle,
      unitAmountPaise: planDef.unitAmountPaise,
      totalAmountPaise: planDef.unitAmountPaise * seats,
      organization: {
        id: organization._id,
        name: organization.name
      }
    };
  }

  async getBillingSummary(user) {
    const status = await getLicenseStatusForUser(user);
    const organizationId = status.organizationId;
    const subscription = await Subscription.findOne({ organization: organizationId });

    return {
      ...status,
      razorpay: subscription
        ? {
            subscriptionId: subscription.razorpaySubscriptionId,
            planId: subscription.razorpayPlanId,
            pendingSeatLimit: subscription.pendingSeatLimit
          }
        : null,
      plans: this.getPlans()
    };
  }

  async cancelSubscription(user, { cancelAtCycleEnd = true }) {
    this.assertConfigured();
    const organizationId = await ensureOrganizationForUser(user);
    const subscription = await getOrganizationSubscription(organizationId);

    if (!subscription?.razorpaySubscriptionId) {
      const err = new Error('No active Razorpay subscription to cancel');
      err.statusCode = 400;
      throw err;
    }

    await this.razorpay.subscriptions.cancel(
      subscription.razorpaySubscriptionId,
      cancelAtCycleEnd
    );

    if (!cancelAtCycleEnd) {
      await this.applySubscriptionCancelled(subscription, { immediate: true });
    } else {
      subscription.notes = `Cancel scheduled at period end ${new Date().toISOString()}`;
      await subscription.save();
    }

    return {
      razorpaySubscriptionId: subscription.razorpaySubscriptionId,
      cancelAtCycleEnd
    };
  }

  validateWebhookSignature(body, signature) {
    const secret =
      process.env.RAZORPAY_BILLING_WEBHOOK_SECRET ||
      process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      logger.warn('RAZORPAY_WEBHOOK_SECRET not set; rejecting billing webhook');
      return false;
    }
    try {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(body))
        .digest('hex');
      return expected === signature;
    } catch (error) {
      logger.error('Billing webhook signature error', error);
      return false;
    }
  }

  async handleWebhookEvent(payload) {
    const event = payload.event;
    logger.info('Billing webhook received', { event });

    switch (event) {
      case 'subscription.authenticated':
        return this.onSubscriptionActivated(payload);

      case 'subscription.activated':
        return this.onSubscriptionActivated(payload);

      case 'subscription.charged':
        return this.onSubscriptionCharged(payload);

      case 'subscription.pending':
        return { success: true, message: 'Subscription pending acknowledged' };

      case 'subscription.halted':
        return this.onSubscriptionHalted(payload);

      case 'subscription.cancelled':
      case 'subscription.completed':
        return this.onSubscriptionCancelled(payload);

      case 'subscription.paused':
        return this.onSubscriptionHalted(payload);

      case 'payment.failed':
        return this.onPaymentFailed(payload);

      default:
        logger.info('Unhandled billing webhook event', { event });
        return { success: true, message: 'Event acknowledged' };
    }
  }

  async findSubscriptionByRazorpayId(razorpaySubscriptionId, notes = {}) {
    let subscription = await Subscription.findOne({ razorpaySubscriptionId });
    if (subscription) {
      return subscription;
    }

    const orgId = notes.organizationId;
    if (orgId) {
      subscription = await getOrganizationSubscription(orgId);
      if (subscription) {
        subscription.razorpaySubscriptionId = razorpaySubscriptionId;
        return subscription;
      }
    }

    return null;
  }

  unixToDate(unixSeconds) {
    if (!unixSeconds) {
      return null;
    }
    return new Date(Number(unixSeconds) * 1000);
  }

  async applySubscriptionActive(subscription, rzEntity, notes = {}) {
    const seatLimit =
      parseInt(rzEntity.quantity, 10) ||
      parseInt(notes.seatLimit, 10) ||
      subscription.pendingSeatLimit ||
      subscription.seatLimit;

    const periodStart = this.unixToDate(rzEntity.current_start) || new Date();
    let periodEnd = this.unixToDate(rzEntity.current_end);

    if (!periodEnd && rzEntity.plan_id) {
      const billingCycle = subscription.billingCycle === 'yearly' ? 'yearly' : 'monthly';
      const days = billingCycle === 'yearly' ? 365 : 30;
      periodEnd = new Date(periodStart.getTime() + days * msPerDay);
    }

    subscription.status = 'active';
    subscription.seatLimit = seatLimit;
    subscription.pendingSeatLimit = undefined;
    subscription.paymentFailedAt = undefined;
    subscription.currentPeriodStart = periodStart;
    subscription.currentPeriodEnd = periodEnd;
    subscription.trialEndsAt = undefined;
    subscription.razorpaySubscriptionId = rzEntity.id || subscription.razorpaySubscriptionId;
    subscription.razorpayPlanId = rzEntity.plan_id || subscription.razorpayPlanId;
    await subscription.save();

    await Organization.findByIdAndUpdate(subscription.organization, {
      status: 'active'
    });

    logger.info('Subscription activated', {
      organizationId: subscription.organization,
      seatLimit,
      periodEnd
    });
  }

  async applySubscriptionPastDue(subscription, reason = 'payment_failed') {
    subscription.status = 'past_due';
    subscription.paymentFailedAt = new Date();
    subscription.notes = reason;
    await subscription.save();

    await Organization.findByIdAndUpdate(subscription.organization, {
      status: 'past_due'
    });

    logger.warn('Subscription marked past_due', {
      organizationId: subscription.organization,
      reason
    });
  }

  async applySubscriptionCancelled(subscription, { immediate = false } = {}) {
    subscription.status = immediate ? 'cancelled' : subscription.status;
    subscription.cancelledAt = new Date();
    subscription.notes = immediate
      ? 'Cancelled immediately'
      : 'Cancelled at end of billing period';
    if (immediate) {
      subscription.currentPeriodEnd = new Date();
    }
    await subscription.save();

    if (immediate) {
      await Organization.findByIdAndUpdate(subscription.organization, {
        status: 'cancelled'
      });
    }

    logger.info('Subscription cancelled', {
      organizationId: subscription.organization,
      immediate
    });
  }

  async onSubscriptionActivated(payload) {
    const entity = payload.payload?.subscription?.entity;
    if (!entity) {
      return { success: false, message: 'Missing subscription entity' };
    }

    if (!shouldActivatePaidSubscription(entity.status)) {
      logger.info('Ignoring subscription activation webhook until paid status', {
        razorpaySubscriptionId: entity.id,
        status: entity.status
      });
      return {
        success: true,
        message: `Subscription status "${entity.status}" — not activating until active`
      };
    }

    const subscription = await this.findSubscriptionByRazorpayId(
      entity.id,
      entity.notes || {}
    );
    if (!subscription) {
      logger.error('Subscription not found for activation webhook', { id: entity.id });
      return { success: false, message: 'Subscription not found' };
    }

    await this.applySubscriptionActive(subscription, entity, entity.notes || {});
    return { success: true, message: 'Subscription activated' };
  }

  async onSubscriptionCharged(payload) {
    const rzSub = payload.payload?.subscription?.entity;
    const payment = payload.payload?.payment?.entity;

    if (!rzSub) {
      return { success: false, message: 'Missing subscription entity' };
    }

    const subscription = await this.findSubscriptionByRazorpayId(rzSub.id, rzSub.notes || {});
    if (!subscription) {
      return { success: false, message: 'Subscription not found' };
    }

    if (payment?.error_code) {
      if (shouldMarkPastDueOnPaymentFailure(subscription.status)) {
        await this.applySubscriptionPastDue(subscription, payment.error_description);
      } else {
        subscription.notes = `Checkout charge failed: ${payment.error_description || 'payment_failed'}`;
        await subscription.save();
      }
    } else if (shouldActivatePaidSubscription(rzSub.status)) {
      await this.applySubscriptionActive(subscription, rzSub, rzSub.notes || {});
    }

    return { success: true, message: 'Subscription charge processed' };
  }

  async onSubscriptionHalted(payload) {
    const entity = payload.payload?.subscription?.entity;
    if (!entity) {
      return { success: false, message: 'Missing subscription entity' };
    }

    const subscription = await this.findSubscriptionByRazorpayId(entity.id, entity.notes || {});
    if (!subscription) {
      return { success: false, message: 'Subscription not found' };
    }

    subscription.status = 'suspended';
    await subscription.save();
    await Organization.findByIdAndUpdate(subscription.organization, { status: 'suspended' });

    return { success: true, message: 'Subscription halted' };
  }

  async onSubscriptionCancelled(payload) {
    const entity = payload.payload?.subscription?.entity;
    if (!entity) {
      return { success: false, message: 'Missing subscription entity' };
    }

    const subscription = await this.findSubscriptionByRazorpayId(entity.id, entity.notes || {});
    if (!subscription) {
      return { success: false, message: 'Subscription not found' };
    }

    const immediate = entity.status === 'cancelled';
    await this.applySubscriptionCancelled(subscription, { immediate });
    return { success: true, message: 'Subscription cancelled processed' };
  }

  async onPaymentFailed(payload) {
    const payment = payload.payload?.payment?.entity;
    const notes = payment?.notes || {};

    if (notes.finsync_product !== 'device_subscription' && !notes.organizationId) {
      return { success: true, message: 'Non-subscription payment ignored' };
    }

    let subscription = null;
    if (notes.organizationId) {
      subscription = await getOrganizationSubscription(notes.organizationId);
    }

    if (!subscription && payment?.subscription_id) {
      subscription = await this.findSubscriptionByRazorpayId(payment.subscription_id, notes);
    }

    if (!subscription) {
      return { success: true, message: 'No matching subscription for failed payment' };
    }

    if (!shouldMarkPastDueOnPaymentFailure(subscription.status)) {
      subscription.notes = `Payment failed during checkout: ${payment?.error_description || 'payment_failed'}`;
      if (subscription.pendingSeatLimit) {
        subscription.notes += ` (pending seats: ${subscription.pendingSeatLimit})`;
      }
      await subscription.save();
      return { success: true, message: 'Checkout payment failed; trial unchanged' };
    }

    await this.applySubscriptionPastDue(subscription, payment?.error_description || 'payment_failed');
    return { success: true, message: 'Payment failure recorded' };
  }

  /**
   * Sync subscription state from Razorpay (manual refresh after checkout).
   */
  async syncFromRazorpay(user) {
    this.assertConfigured();
    const organizationId = await ensureOrganizationForUser(user);
    const subscription = await getOrganizationSubscription(organizationId);

    if (!subscription?.razorpaySubscriptionId) {
      const err = new Error('No Razorpay subscription on file');
      err.statusCode = 400;
      throw err;
    }

    const rz = await this.razorpay.subscriptions.fetch(subscription.razorpaySubscriptionId);

    if (shouldActivatePaidSubscription(rz.status)) {
      await this.applySubscriptionActive(subscription, rz, rz.notes || {});
    } else if (['created', 'pending'].includes(rz.status)) {
      logger.info('Razorpay subscription not paid yet', {
        razorpaySubscriptionId: subscription.razorpaySubscriptionId,
        status: rz.status
      });
    } else if (['halted', 'paused'].includes(rz.status)) {
      await this.onSubscriptionHalted({
        payload: { subscription: { entity: rz } }
      });
    } else if (['cancelled', 'completed', 'expired'].includes(rz.status)) {
      await this.applySubscriptionCancelled(subscription, { immediate: true });
    }

    const refreshed = await Subscription.findById(subscription._id);
    const access = evaluateSubscription(refreshed);
    return {
      razorpayStatus: rz.status,
      access,
      subscription: {
        status: refreshed.status,
        seatLimit: refreshed.seatLimit,
        currentPeriodEnd: refreshed.currentPeriodEnd
      }
    };
  }
}

export default new SubscriptionBillingService();
