'use strict';

/**
 * Seconds-since-epoch expiry of a JWT, read without verifying it. Returns null
 * when the token is missing or not a decodable JWT.
 *
 * The agent only needs to know whether its own access token is about to lapse;
 * the server still verifies the signature on every request.
 */
function readTokenExpiry(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * True when the access token is missing, undecodable, or expires within
 * `marginMs`. Refreshing only in that case matters: every refresh returns a new
 * token, and treating each new token as a reason to reconnect is what kept a
 * freshly signed-in agent cycling its WebSocket instead of syncing.
 */
function tokenExpiresWithin(token, marginMs = 2 * 60 * 1000, now = Date.now()) {
  const exp = readTokenExpiry(token);
  if (exp == null) return true;
  return exp * 1000 - now <= marginMs;
}

module.exports = { readTokenExpiry, tokenExpiresWithin };
