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
 * How long a retired refresh token stays acceptable after being rotated out.
 * Long enough to absorb a client racing itself or restarting mid-rotation,
 * short enough that a captured token replayed later is still caught.
 */
const REFRESH_GRACE_MS = 10 * 60 * 1000;

/**
 * How many retired hashes to keep. The desktop agent refreshes from several
 * independent code paths at once; each of those gets its own new token, and the
 * client keeps whichever response landed last. Remembering only one would strand
 * the others.
 */
const RECENT_HASH_LIMIT = 5;

/**
 * Minimum gap between actual rotations.
 *
 * Rotating on every single refresh is what made concurrency dangerous: several
 * callers read the same row, each minted a token, and only the last write
 * survived — so the tokens handed to the others were already forgotten. Access
 * tokens last 30 minutes, so rotating at most once a minute costs nothing and
 * makes a burst of simultaneous refreshes harmless: the first rotates, the rest
 * get a fresh access token and keep the refresh token they already hold.
 */
const ROTATE_MIN_INTERVAL_MS = 60 * 1000;

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
 * Age of a refresh token from its own `iat`. The route has already verified the
 * signature, so decoding is enough here. Unreadable means "old", which errs
 * towards rotating rather than towards keeping a token alive.
 */
const tokenAgeMs = (rawToken, now) => {
  try {
    const decoded = jwt.decode(rawToken);
    return decoded?.iat ? now - decoded.iat * 1000 : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

/** Tolerates the column arriving as JSON text, an array, or null. */
const parseRecentHashes = (value) => {
  if (!value) return [];
  const list = typeof value === 'string' ? safeJson(value) : value;
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e.hash === 'string')
    .map((e) => ({ hash: e.hash, at: Number(e.at) || 0 }));
};

const safeJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
};

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
  const now = Date.now();
  const recent = parseRecentHashes(session.recentRefreshHashes);

  if (session.refreshTokenHash !== presented) {
    // A recently retired token is still honoured. A client that raced itself,
    // or restarted before it could persist the new token, is indistinguishable
    // from a thief if we only ever accept the very latest hash — and the
    // desktop agent does race itself, from several code paths at once. It was
    // being signed out one second after login, every morning.
    //
    // The property that matters survives: a token captured and replayed after
    // the window, or after enough rotations to fall off the list, is caught.
    const match = recent.find((e) => e.hash === presented && now - e.at <= REFRESH_GRACE_MS);

    if (!match) {
      await revokeSession(sessionId, 'refresh_token_reuse');
      logger.warn('Refresh token reuse detected; session revoked', {
        userId: String(userId),
        sessionId: String(sessionId),
        deviceId: session.deviceId,
      });
      return { ok: false, reason: 'REFRESH_TOKEN_REUSED' };
    }

    logger.info('Retired refresh token accepted inside the grace window', {
      sessionId: String(sessionId),
      deviceId: session.deviceId,
      ageMs: now - match.at,
    });
  }

  const token = signAccessToken(String(userId), String(sessionId));

  // Whether to rotate is decided from the presented token's own age, never from
  // the row. Every caller in a burst holds the same token and therefore reaches
  // the same answer without reading shared state — which is the only way to be
  // safe here, since read-then-write on one row cannot be made atomic through
  // this data layer. A burst always follows a token being issued (login, or a
  // reconnect just after a refresh), so in practice the burst never rotates.
  const shouldRotate = tokenAgeMs(presentedToken, now) > ROTATE_MIN_INTERVAL_MS;

  if (!shouldRotate) {
    // A sibling request rotated a moment ago. Hand back a fresh access token
    // and let this caller keep the refresh token it already has — re-asserting
    // it as current, because the client is the authority on which token it
    // actually kept. Nothing is minted, so nothing can be lost in a race.
    await Session.findByIdAndUpdate(sessionId, {
      refreshTokenHash: presented,
      recentRefreshHashes: [
        { hash: session.refreshTokenHash, at: now },
        ...recent.filter((e) => e.hash !== session.refreshTokenHash && e.hash !== presented),
      ]
        .filter((e) => e.hash && e.hash !== presented && now - e.at <= REFRESH_GRACE_MS)
        .slice(0, RECENT_HASH_LIMIT),
      lastSeenAt: new Date(),
      lastIp: ip || session.lastIp || null,
    });

    return { ok: true, token, refreshToken: presentedToken };
  }

  const refreshToken = signRefreshToken(String(userId), String(sessionId));

  // The hash being retired goes to the front, so the token this caller was
  // holding keeps working for any sibling request still in flight.
  const nextRecent = [
    { hash: session.refreshTokenHash, at: now },
    { hash: presented, at: now },
    ...recent,
  ]
    .filter((e, i, all) => e.hash && now - e.at <= REFRESH_GRACE_MS && all.findIndex((x) => x.hash === e.hash) === i)
    .slice(0, RECENT_HASH_LIMIT);

  await Session.findByIdAndUpdate(sessionId, {
    refreshTokenHash: hashToken(refreshToken),
    recentRefreshHashes: nextRecent,
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
