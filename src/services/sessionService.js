/**
 * Server-side sessions.
 *
 * A JWT cannot be withdrawn once issued, so "sign out my other device" is
 * impossible with stateless tokens alone. Every access token now carries the id
 * of a row in `sessions`, and `protect` checks that row on each request — which
 * costs nothing extra, because it already loads the user from the database.
 *
 * The same table is what enforces one-device-at-a-time: a second device is
 * refused until the first session is revoked, either by that device logging out
 * or by the new device explicitly taking over.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

import { Session } from '../models/index.js';
import logger from '../utils/logger.js';

/** Short, because revocation only takes effect when the access token expires. */
export const ACCESS_TOKEN_TTL = process.env.JWT_EXPIRE || '30m';
export const REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_EXPIRE || '30d';

/** A session with no activity for this long stops blocking a new sign-in. */
const STALE_SESSION_DAYS = 45;

/**
 * How long the previous refresh token stays acceptable after a rotation.
 * Long enough to absorb a client racing itself or restarting mid-rotation,
 * short enough that a captured token replayed later is still caught.
 */
const REFRESH_GRACE_MS = 60 * 1000;

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * `iat` only has one-second resolution, so signing the same payload twice
 * inside the same second produces a byte-identical token. Two rotations in
 * quick succession would then yield a "new" refresh token equal to the old
 * one, its hash would still match, and reuse detection would never fire. The
 * random jti makes every token unique.
 */
const jti = () => crypto.randomBytes(16).toString('hex');

const signAccessToken = (userId, sessionId) =>
  jwt.sign({ id: userId, sid: sessionId, jti: jti() }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });

const signRefreshToken = (userId, sessionId) =>
  jwt.sign({ id: userId, sid: sessionId, type: 'refresh', jti: jti() }, process.env.JWT_SECRET, {
    expiresIn: REFRESH_TOKEN_TTL,
  });

/**
 * The desktop agent and the mobile app are companions, not rivals: the agent
 * pushes Tally data from the PC while the phone reads it, so the same person
 * must be signed in on both at once. The one-device rule therefore applies
 * within a client type, never across them — a phone signing in must not knock
 * the agent offline and stop the sync.
 *
 * Derived from `platform` rather than stored, so sessions created before this
 * distinction existed classify correctly without a migration.
 */
export const clientTypeOf = (platform) =>
  String(platform || '').toLowerCase() === 'desktop' ? 'desktop' : 'mobile';

/** What the client is told about the device currently holding the session. */
export const describeSession = (session) => ({
  deviceId: session.deviceId,
  deviceName: session.deviceName || 'Unknown device',
  platform: session.platform || null,
  lastSeenAt: session.lastSeenAt || session.createdAt || null,
});

const staleBefore = () => new Date(Date.now() - STALE_SESSION_DAYS * 24 * 60 * 60 * 1000);

/**
 * Sessions that should still block a new sign-in: not revoked, and seen
 * recently enough that the device is plausibly still in use. Without the
 * staleness window a customer who factory-reset a phone a year ago would be
 * locked out with nothing to log out from.
 */
export async function findBlockingSession(userId, deviceId, clientType = 'mobile') {
  const sessions = await Session.find({
    userId: String(userId),
    revokedAt: null,
  });

  const cutoff = staleBefore();
  return (
    sessions.find((s) => {
      if (s.deviceId === deviceId) return false;
      // A desktop agent never blocks a phone, and a phone never blocks the
      // agent. Only another device of the same kind occupies the slot.
      if (clientTypeOf(s.platform) !== clientType) return false;
      const seen = s.lastSeenAt || s.createdAt;
      return !seen || new Date(seen) >= cutoff;
    }) || null
  );
}

export async function revokeSession(sessionId, reason = 'logout') {
  if (!sessionId) return;
  await Session.findByIdAndUpdate(sessionId, {
    revokedAt: new Date(),
    revokeReason: reason,
    refreshTokenHash: null,
  });
}

/**
 * Used by takeover and by "sign out everywhere".
 *
 * `clientType` limits the sweep to one kind of client. A phone taking over
 * must pass it, or signing in on a new phone would also sign the desktop agent
 * out and stop the customer's Tally sync. Omitting it revokes everything, which
 * is what a password change wants.
 */
export async function revokeOtherSessions(
  userId,
  keepDeviceId,
  reason = 'signed_in_elsewhere',
  clientType = null
) {
  const sessions = await Session.find({ userId: String(userId), revokedAt: null });
  let revoked = 0;
  for (const s of sessions) {
    if (keepDeviceId && s.deviceId === keepDeviceId) continue;
    if (clientType && clientTypeOf(s.platform) !== clientType) continue;
    await revokeSession(s._id || s.id, reason);
    revoked += 1;
  }
  if (revoked) {
    logger.info('Revoked sessions on takeover', { userId: String(userId), revoked, reason });
  }
  return revoked;
}

/**
 * Start a session for a device, replacing any previous session that same device
 * held. Reinstalling the app on the same phone must not lock the user out.
 */
export async function createSession({ userId, device = {}, ip }) {
  const deviceId = device.deviceId || 'unknown';

  const existing = await Session.find({ userId: String(userId), deviceId, revokedAt: null });
  for (const s of existing) {
    await revokeSession(s._id || s.id, 'replaced_by_new_login');
  }

  const session = await Session.create({
    userId: String(userId),
    deviceId,
    deviceName: device.deviceName || null,
    platform: device.platform || null,
    appVersion: device.appVersion || null,
    lastIp: ip || null,
    lastSeenAt: new Date(),
  });

  const sessionId = String(session._id || session.id);
  const token = signAccessToken(String(userId), sessionId);
  const refreshToken = signRefreshToken(String(userId), sessionId);

  await Session.findByIdAndUpdate(sessionId, { refreshTokenHash: hashToken(refreshToken) });

  return { sessionId, token, refreshToken };
}

/**
 * Rotate a refresh token.
 *
 * The stored hash is replaced on every use, so a token presented twice cannot
 * match. That mismatch is the signal we care about: either the token was
 * replayed or it was copied to another device, and both mean the session is no
 * longer trustworthy, so it is killed outright rather than refreshed.
 */
export async function rotateRefreshToken({ userId, sessionId, presentedToken, ip }) {
  const session = await Session.findById(sessionId);

  if (!session || session.revokedAt) {
    return { ok: false, reason: 'SESSION_REVOKED' };
  }
  if (String(session.userId) !== String(userId)) {
    return { ok: false, reason: 'SESSION_REVOKED' };
  }

  const presented = hashToken(presentedToken);

  if (session.refreshTokenHash !== presented) {
    // The token just replaced by a rotation is honoured for a short window.
    //
    // Without this, a client that legitimately raced itself — two request
    // handlers refreshing at once, or a crash between receiving the new token
    // and writing it to disk — looks identical to a stolen token and gets its
    // session destroyed. That is exactly what happened to the desktop agent:
    // it was killed twice, once in the same second it signed in.
    //
    // The security property survives. A token captured and replayed later,
    // which is the case worth catching, still falls outside the window.
    const withinGrace =
      session.prevRefreshTokenHash === presented &&
      session.prevRotatedAt &&
      Date.now() - new Date(session.prevRotatedAt).getTime() <= REFRESH_GRACE_MS;

    if (!withinGrace) {
      await revokeSession(sessionId, 'refresh_token_reuse');
      logger.warn('Refresh token reuse detected; session revoked', {
        userId: String(userId),
        sessionId: String(sessionId),
        deviceId: session.deviceId,
      });
      return { ok: false, reason: 'REFRESH_TOKEN_REUSED' };
    }

    logger.info('Refresh token replayed inside the grace window; treating as a race', {
      sessionId: String(sessionId),
      deviceId: session.deviceId,
    });
  }

  const token = signAccessToken(String(userId), String(sessionId));
  const refreshToken = signRefreshToken(String(userId), String(sessionId));

  await Session.findByIdAndUpdate(sessionId, {
    refreshTokenHash: hashToken(refreshToken),
    prevRefreshTokenHash: session.refreshTokenHash,
    prevRotatedAt: new Date(),
    lastSeenAt: new Date(),
    lastIp: ip || session.lastIp || null,
  });

  return { ok: true, token, refreshToken };
}

/**
 * Turns a stored revokeReason into something true to show the user. Reporting
 * every revocation as "used on another device" was actively misleading: it sent
 * people hunting for a second device that did not exist.
 */
export const revokedMessage = (reason) => {
  switch (reason) {
    case 'signed_in_elsewhere':
    case 'replaced_by_new_login':
      return 'You were signed out because this account was signed in on another device.';
    case 'password_reset':
      return 'You were signed out because the password was changed. Please sign in again.';
    case 'refresh_token_reuse':
      return 'This session was ended for security reasons. Please sign in again.';
    case 'revoked_by_user':
      return 'This device was signed out from another device.';
    default:
      return 'Your session has ended. Please sign in again.';
  }
};

/** Called by `protect`. Returns null when the session is gone or revoked. */
export async function touchSession(sessionId, ip) {
  const session = await Session.findById(sessionId);
  if (!session || session.revokedAt) return null;

  // Throttled so a busy client does not write on every single request.
  const last = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
  if (Date.now() - last > 60 * 1000) {
    await Session.findByIdAndUpdate(sessionId, { lastSeenAt: new Date(), lastIp: ip || null });
  }
  return session;
}

/** Reads a session even when revoked, so callers can explain why it ended. */
export async function getRevokedSession(sessionId) {
  if (!sessionId) return null;
  return Session.findById(sessionId);
}

export async function listSessions(userId) {
  const sessions = await Session.find({ userId: String(userId), revokedAt: null });
  return sessions.map((s) => ({ id: String(s._id || s.id), ...describeSession(s) }));
}

export const __testing = { hashToken, staleBefore };
