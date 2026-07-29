import {
  shouldActivatePaidSubscription,
  shouldMarkPastDueOnPaymentFailure
} from '../src/services/subscriptionBillingService.js';
import { evaluateSubscription } from '../src/services/licenseService.js';

describe('subscriptionBillingService helpers', () => {
  test('shouldActivatePaidSubscription only allows active', () => {
    expect(shouldActivatePaidSubscription('active')).toBe(true);
    expect(shouldActivatePaidSubscription('authenticated')).toBe(false);
    expect(shouldActivatePaidSubscription('created')).toBe(false);
    expect(shouldActivatePaidSubscription('pending')).toBe(false);
  });

  test('shouldMarkPastDueOnPaymentFailure protects trial checkout', () => {
    expect(shouldMarkPastDueOnPaymentFailure('trial')).toBe(false);
    expect(shouldMarkPastDueOnPaymentFailure('active')).toBe(true);
    expect(shouldMarkPastDueOnPaymentFailure('past_due')).toBe(true);
  });
});

describe('evaluateSubscription expiry', () => {
  test('trial ends after trialEndsAt', () => {
    const past = new Date(Date.now() - 86400000);
    const result = evaluateSubscription({
      status: 'trial',
      trialEndsAt: past,
      currentPeriodEnd: past,
      seatLimit: 1
    });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe('trial_expired');
  });

  test('active subscription ends after currentPeriodEnd', () => {
    const past = new Date(Date.now() - 86400000);
    const result = evaluateSubscription({
      status: 'active',
      currentPeriodEnd: past,
      seatLimit: 1
    });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe('expired');
  });

  test('active subscription allowed before period end', () => {
    const future = new Date(Date.now() + 365 * 86400000);
    const result = evaluateSubscription({
      status: 'active',
      currentPeriodEnd: future,
      seatLimit: 1
    });
    expect(result.allowed).toBe(true);
    expect(result.status).toBe('active');
  });
});
