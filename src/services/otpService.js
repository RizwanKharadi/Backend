/**
 * One-time passcodes for email verification and password reset.
 *
 * Security properties this file is responsible for:
 *  - codes are generated with a CSPRNG, never Math.random
 *  - only an HMAC of the code is stored, so a database dump does not hand an
 *    attacker working codes
 *  - comparison is constant-time, so response timing does not leak digits
 *  - a code is single-use, expires, and dies after a handful of wrong guesses
 *  - sending is rate limited per address, so the endpoint cannot be used to
 *    flood someone's inbox or burn through the mail server's quota
 *
 * Callers get the plaintext code back exactly once, from `issueOtp`, and are
 * expected to put it straight into an email. It is never logged.
 */
import crypto from 'crypto';
import { Op } from 'sequelize';
import Otp from '../models/Otp.js';
import logger from '../utils/logger.js';

export const OTP_PURPOSES = {
  EMAIL_VERIFICATION: 'email_verification',
  PASSWORD_RESET: 'password_reset',
};

export const OTP_CONFIG = {
  length: 6,
  ttlMs: 10 * 60 * 1000, // 10 minutes
  maxAttempts: 5, // wrong guesses before the code is burned
  resendCooldownMs: 60 * 1000, // 1 minute between sends
  maxSendsPerWindow: 5,
  sendWindowMs: 60 * 60 * 1000, // rolling hour
};

/** Reasons a caller may need to distinguish. Never surfaced verbatim to users. */
export const OTP_ERRORS = {
  COOLDOWN: 'cooldown',
  RATE_LIMITED: 'rate_limited',
  NOT_FOUND: 'not_found',
  EXPIRED: 'expired',
  TOO_MANY_ATTEMPTS: 'too_many_attempts',
  INVALID: 'invalid',
};

function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * HMAC rather than a bare hash: a 6-digit code has only a million values, so
 * sha256(code) in a leaked table is reversible in milliseconds. The key means
 * the attacker also needs the server secret.
 */
function hashCode(code, email, purpose) {
  const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('OTP_SECRET or JWT_SECRET must be set to issue OTPs');
  }
  return crypto
    .createHmac('sha256', secret)
    // Bind the digest to the address and purpose so a code issued for one
    // cannot be replayed against the other.
    .update(`${purpose}:${normaliseEmail(email)}:${code}`)
    .digest('hex');
}

function generateCode(length = OTP_CONFIG.length) {
  const max = 10 ** length;
  // randomInt is uniform and CSPRNG-backed; padStart keeps leading zeros so
  // "004321" stays a six-digit code.
  return String(crypto.randomInt(0, max)).padStart(length, '0');
}

function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Issue a code for `email`/`purpose`, replacing any code already outstanding.
 *
 * Returns `{ ok: true, code }` — the plaintext is for the email only.
 * On refusal returns `{ ok: false, reason, retryAfterSeconds }`.
 */
export async function issueOtp(email, purpose) {
  const addr = normaliseEmail(email);
  const now = Date.now();

  let record = await Otp.findOne({ email: addr, purpose });

  // Rate limiting is evaluated before anything is generated, so a refused
  // request costs nothing and cannot be used to churn codes.
  if (record) {
    const lastSentAt = record.lastSentAt ? new Date(record.lastSentAt).getTime() : 0;
    const sinceLastSend = now - lastSentAt;
    if (lastSentAt && sinceLastSend < OTP_CONFIG.resendCooldownMs) {
      return {
        ok: false,
        reason: OTP_ERRORS.COOLDOWN,
        retryAfterSeconds: Math.ceil((OTP_CONFIG.resendCooldownMs - sinceLastSend) / 1000),
      };
    }

    const windowStartedAt = record.windowStartedAt
      ? new Date(record.windowStartedAt).getTime()
      : 0;
    const windowOpen = windowStartedAt && now - windowStartedAt < OTP_CONFIG.sendWindowMs;

    if (windowOpen && (record.sendCount || 0) >= OTP_CONFIG.maxSendsPerWindow) {
      return {
        ok: false,
        reason: OTP_ERRORS.RATE_LIMITED,
        retryAfterSeconds: Math.ceil(
          (OTP_CONFIG.sendWindowMs - (now - windowStartedAt)) / 1000
        ),
      };
    }
  }

  const code = generateCode();
  const codeHash = hashCode(code, addr, purpose);
  const expiresAt = new Date(now + OTP_CONFIG.ttlMs);

  const windowStartedAt = record?.windowStartedAt
    ? new Date(record.windowStartedAt).getTime()
    : 0;
  const windowStillOpen =
    windowStartedAt && now - windowStartedAt < OTP_CONFIG.sendWindowMs;

  const payload = {
    email: addr,
    purpose,
    codeHash,
    expiresAt,
    attempts: 0,
    consumedAt: null,
    lastSentAt: new Date(now),
    sendCount: windowStillOpen ? (record.sendCount || 0) + 1 : 1,
    windowStartedAt: windowStillOpen ? record.windowStartedAt : new Date(now),
  };

  if (record) {
    await Otp.findByIdAndUpdate(record.id, payload);
  } else {
    await Otp.create(payload);
  }

  // Deliberately no logging of `code` — an OTP in the log file is an OTP an
  // operator (or log aggregator) can use.
  logger.info(`OTP issued for ${addr} (${purpose})`);

  return { ok: true, code, expiresInMinutes: Math.round(OTP_CONFIG.ttlMs / 60000) };
}

/**
 * Check a code. Consumes it on success so it cannot be replayed.
 */
export async function verifyOtp(email, purpose, code) {
  const addr = normaliseEmail(email);
  const record = await Otp.findOne({ email: addr, purpose });

  if (!record || record.consumedAt) {
    return { ok: false, reason: OTP_ERRORS.NOT_FOUND };
  }

  if (new Date(record.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: OTP_ERRORS.EXPIRED };
  }

  if ((record.attempts || 0) >= OTP_CONFIG.maxAttempts) {
    return { ok: false, reason: OTP_ERRORS.TOO_MANY_ATTEMPTS };
  }

  const candidate = hashCode(String(code || '').trim(), addr, purpose);

  if (!timingSafeEqualHex(candidate, record.codeHash)) {
    const attempts = (record.attempts || 0) + 1;
    await Otp.findByIdAndUpdate(record.id, { attempts });
    return {
      ok: false,
      reason: OTP_ERRORS.INVALID,
      attemptsRemaining: Math.max(0, OTP_CONFIG.maxAttempts - attempts),
    };
  }

  // Single use: mark consumed rather than deleting, so the rate-limit window
  // survives and a replay is distinguishable from "never requested".
  await Otp.findByIdAndUpdate(record.id, { consumedAt: new Date() });
  logger.info(`OTP verified for ${addr} (${purpose})`);

  return { ok: true };
}

/** Drop any outstanding code, e.g. once a password has actually been changed. */
export async function clearOtp(email, purpose) {
  await Otp.deleteOne({ email: normaliseEmail(email), purpose });
}

/**
 * Housekeeping: remove codes that expired a while ago. Consumed and expired
 * rows are kept briefly so the rate-limit window still applies to someone
 * cycling codes.
 */
export async function purgeExpiredOtps() {
  const cutoff = new Date(Date.now() - OTP_CONFIG.sendWindowMs);
  const deleted = await Otp.deleteMany({ expiresAt: { [Op.lt]: cutoff } });
  return deleted;
}

export default { issueOtp, verifyOtp, clearOtp, purgeExpiredOtps, OTP_PURPOSES, OTP_CONFIG };
