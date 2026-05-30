import { validationResult } from 'express-validator';
import subscriptionBillingService from '../services/subscriptionBillingService.js';
import logger from '../utils/logger.js';

export const listPlans = async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      plans: subscriptionBillingService.getPlans(),
      mobileIncluded: true,
      currency: 'INR'
    }
  });
};

export const getBillingStatus = async (req, res) => {
  try {
    const summary = await subscriptionBillingService.getBillingSummary(req.user);
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    logger.error('getBillingStatus error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

export const createCheckout = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { billingCycle, seatLimit } = req.body;
    const checkout = await subscriptionBillingService.createSubscriptionCheckout(req.user, {
      billingCycle,
      seatLimit
    });

    res.status(201).json({
      success: true,
      message: 'Open the payment link to complete subscription',
      data: checkout
    });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('createCheckout error:', error);
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to create checkout'
    });
  }
};

export const syncSubscription = async (req, res) => {
  try {
    const result = await subscriptionBillingService.syncFromRazorpay(req.user);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message || 'Sync failed' });
  }
};

export const cancelSubscription = async (req, res) => {
  try {
    const cancelAtCycleEnd = req.body.cancelAtCycleEnd !== false;
    const result = await subscriptionBillingService.cancelSubscription(req.user, {
      cancelAtCycleEnd
    });
    res.status(200).json({
      success: true,
      message: cancelAtCycleEnd
        ? 'Subscription will cancel at the end of the current period'
        : 'Subscription cancelled',
      data: result
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message || 'Cancel failed' });
  }
};

export const handleBillingWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
      return res.status(400).json({ success: false, message: 'Missing webhook signature' });
    }

    const isValid = subscriptionBillingService.validateWebhookSignature(req.body, signature);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    }

    const result = await subscriptionBillingService.handleWebhookEvent(req.body);
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    logger.error('Billing webhook error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
