/**
 * OTP service behaviour. These are the security properties, so they are tested
 * against a fake store rather than mocked away.
 */
import { jest } from '@jest/globals';

process.env.JWT_SECRET = 'test-secret-for-otp';

// In-memory stand-in for the Otp model, matching the compat API used by the
// service (findOne / create / findByIdAndUpdate / deleteOne).
const store = new Map();
const key = (email, purpose) => `${email}|${purpose}`;

jest.unstable_mockModule('../src/models/Otp.js', () => ({
  default: {
    findOne: async ({ email, purpose }) => store.get(key(email, purpose)) ?? null,
    create: async (data) => {
      const row = { id: `otp-${store.size + 1}`, ...data };
      store.set(key(data.email, data.purpose), row);
      return row;
    },
    findByIdAndUpdate: async (id, patch) => {
      for (const [k, v] of store) {
        if (v.id === id) { store.set(k, { ...v, ...patch }); return store.get(k); }
      }
      return null;
    },
    deleteOne: async ({ email, purpose }) => store.delete(key(email, purpose)),
    deleteMany: async () => 0,
  },
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: () => {}, warn: () => {}, error: () => {} },
}));

const { issueOtp, verifyOtp, clearOtp, OTP_PURPOSES, OTP_CONFIG, OTP_ERRORS } =
  await import('../src/services/otpService.js');

const EMAIL = 'user@example.com';
const P = OTP_PURPOSES.EMAIL_VERIFICATION;

beforeEach(() => store.clear());

describe('issueOtp', () => {
  it('returns a numeric code of the configured length', async () => {
    const r = await issueOtp(EMAIL, P);
    expect(r.ok).toBe(true);
    expect(r.code).toMatch(new RegExp(`^\\d{${OTP_CONFIG.length}}$`));
  });

  it('never stores the code in plaintext', async () => {
    const { code } = await issueOtp(EMAIL, P);
    const row = store.get(key(EMAIL, P));
    expect(row.codeHash).not.toContain(code);
    expect(row.codeHash).toHaveLength(64); // sha256 hex
  });

  it('is case-insensitive about the address', async () => {
    const { code } = await issueOtp('User@Example.COM', P);
    expect((await verifyOtp(EMAIL, P, code)).ok).toBe(true);
  });

  it('refuses a resend inside the cooldown', async () => {
    await issueOtp(EMAIL, P);
    const second = await issueOtp(EMAIL, P);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe(OTP_ERRORS.COOLDOWN);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('caps sends within the rolling window', async () => {
    // Walk past the cooldown each time, but stay inside the hour window.
    for (let i = 0; i < OTP_CONFIG.maxSendsPerWindow; i++) {
      const r = await issueOtp(EMAIL, P);
      expect(r.ok).toBe(true);
      const row = store.get(key(EMAIL, P));
      row.lastSentAt = new Date(Date.now() - OTP_CONFIG.resendCooldownMs - 1000);
    }
    const blocked = await issueOtp(EMAIL, P);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe(OTP_ERRORS.RATE_LIMITED);
  });

  it('replaces the previous code, so only the newest works', async () => {
    const first = await issueOtp(EMAIL, P);
    const row = store.get(key(EMAIL, P));
    row.lastSentAt = new Date(Date.now() - OTP_CONFIG.resendCooldownMs - 1000);
    const second = await issueOtp(EMAIL, P);

    expect((await verifyOtp(EMAIL, P, first.code)).ok).toBe(false);
    expect((await verifyOtp(EMAIL, P, second.code)).ok).toBe(true);
  });
});

describe('verifyOtp', () => {
  it('accepts the right code once and rejects a replay', async () => {
    const { code } = await issueOtp(EMAIL, P);
    expect((await verifyOtp(EMAIL, P, code)).ok).toBe(true);

    const replay = await verifyOtp(EMAIL, P, code);
    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe(OTP_ERRORS.NOT_FOUND);
  });

  it('rejects a code issued for a different purpose', async () => {
    const { code } = await issueOtp(EMAIL, OTP_PURPOSES.PASSWORD_RESET);
    const wrongPurpose = await verifyOtp(EMAIL, OTP_PURPOSES.EMAIL_VERIFICATION, code);
    expect(wrongPurpose.ok).toBe(false);
  });

  it('rejects a code issued for a different address', async () => {
    const { code } = await issueOtp(EMAIL, P);
    expect((await verifyOtp('someone.else@example.com', P, code)).ok).toBe(false);
  });

  it('expires', async () => {
    const { code } = await issueOtp(EMAIL, P);
    store.get(key(EMAIL, P)).expiresAt = new Date(Date.now() - 1000);
    const r = await verifyOtp(EMAIL, P, code);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(OTP_ERRORS.EXPIRED);
  });

  it('burns the code after too many wrong guesses', async () => {
    const { code } = await issueOtp(EMAIL, P);
    for (let i = 0; i < OTP_CONFIG.maxAttempts; i++) {
      const r = await verifyOtp(EMAIL, P, '000000');
      expect(r.ok).toBe(false);
    }
    // Even the correct code is refused once the budget is spent.
    const afterBurn = await verifyOtp(EMAIL, P, code);
    expect(afterBurn.ok).toBe(false);
    expect(afterBurn.reason).toBe(OTP_ERRORS.TOO_MANY_ATTEMPTS);
  });

  it('counts down remaining attempts', async () => {
    await issueOtp(EMAIL, P);
    const r = await verifyOtp(EMAIL, P, '999999');
    expect(r.attemptsRemaining).toBe(OTP_CONFIG.maxAttempts - 1);
  });

  it('reports nothing useful when no code was ever requested', async () => {
    const r = await verifyOtp('stranger@example.com', P, '123456');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(OTP_ERRORS.NOT_FOUND);
  });
});

describe('clearOtp', () => {
  it('removes an outstanding code', async () => {
    await issueOtp(EMAIL, P);
    await clearOtp(EMAIL, P);
    expect(store.get(key(EMAIL, P))).toBeUndefined();
  });
});
