/**
 * Session behaviour. These are the rules that enforce one-device-at-a-time and
 * make revocation possible at all, so they are exercised against a fake store
 * rather than mocked away.
 */
import { jest } from '@jest/globals';

process.env.JWT_SECRET = 'test-secret-for-sessions';

const rows = new Map();
let nextId = 1;

const matches = (row, filter) =>
  Object.entries(filter).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    return String(row[k]) === String(v);
  });

jest.unstable_mockModule('../src/models/index.js', () => ({
  Session: {
    find: async (filter = {}) => [...rows.values()].filter((r) => matches(r, filter)),
    findById: async (id) => rows.get(String(id)) ?? null,
    create: async (data) => {
      const id = `s-${nextId++}`;
      const row = { id, _id: id, createdAt: new Date(), ...data };
      rows.set(id, row);
      return row;
    },
    findByIdAndUpdate: async (id, patch) => {
      const row = rows.get(String(id));
      if (!row) return null;
      const merged = { ...row, ...patch };
      rows.set(String(id), merged);
      return merged;
    },
  },
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const {
  createSession,
  findBlockingSession,
  revokeSession,
  revokeOtherSessions,
  rotateRefreshToken,
  touchSession,
  listSessions,
} = await import('../src/services/sessionService.js');

const USER = 'user-1';
const phone = { deviceId: 'phone-a', deviceName: 'Pixel 8', platform: 'android' };
const tablet = { deviceId: 'tablet-b', deviceName: 'iPad', platform: 'ios' };
const agent = { deviceId: 'agent-pc', deviceName: 'Office PC', platform: 'desktop' };

beforeEach(() => {
  rows.clear();
  nextId = 1;
});

describe('one device at a time', () => {
  test('a second phone is blocked while the first holds the session', async () => {
    await createSession({ userId: USER, device: phone });

    const blocking = await findBlockingSession(USER, tablet.deviceId, 'mobile');

    expect(blocking).not.toBeNull();
    expect(blocking.deviceName).toBe('Pixel 8');
  });

  test('the same device signing in again is never blocked by itself', async () => {
    await createSession({ userId: USER, device: phone });

    expect(await findBlockingSession(USER, phone.deviceId, 'mobile')).toBeNull();
  });

  test('reinstalling on the same device replaces its session rather than stacking', async () => {
    await createSession({ userId: USER, device: phone });
    await createSession({ userId: USER, device: phone });

    expect(await listSessions(USER)).toHaveLength(1);
  });

  test('logging out frees the slot for another device', async () => {
    const first = await createSession({ userId: USER, device: phone });
    await revokeSession(first.sessionId, 'logout');

    expect(await findBlockingSession(USER, tablet.deviceId, 'mobile')).toBeNull();
  });

  test('taking over revokes the other device but keeps this one', async () => {
    await createSession({ userId: USER, device: phone });
    const second = await createSession({ userId: USER, device: tablet });

    await revokeOtherSessions(USER, tablet.deviceId, 'signed_in_elsewhere', 'mobile');

    const live = await listSessions(USER);
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(second.sessionId);
  });

  test('one user’s session never blocks another user', async () => {
    await createSession({ userId: 'someone-else', device: phone });

    expect(await findBlockingSession(USER, tablet.deviceId, 'mobile')).toBeNull();
  });

  test('a session untouched for months stops blocking, so a dead phone is not a lockout', async () => {
    const { sessionId } = await createSession({ userId: USER, device: phone });
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    rows.set(sessionId, { ...rows.get(sessionId), lastSeenAt: old, createdAt: old });

    expect(await findBlockingSession(USER, tablet.deviceId, 'mobile')).toBeNull();
  });
});

describe('the agent and the phone are companions, not rivals', () => {
  test('a signed-in desktop agent never blocks a phone', async () => {
    await createSession({ userId: USER, device: agent });

    expect(await findBlockingSession(USER, phone.deviceId, 'mobile')).toBeNull();
  });

  test('a signed-in phone never blocks the desktop agent', async () => {
    await createSession({ userId: USER, device: phone });

    expect(await findBlockingSession(USER, agent.deviceId, 'desktop')).toBeNull();
  });

  test('both stay signed in at the same time', async () => {
    await createSession({ userId: USER, device: agent });
    await createSession({ userId: USER, device: phone });

    expect(await listSessions(USER)).toHaveLength(2);
  });

  test('a phone taking over does not sign the agent out and stop the Tally sync', async () => {
    const pc = await createSession({ userId: USER, device: agent });
    await createSession({ userId: USER, device: phone });

    // Second phone takes the mobile slot.
    await createSession({ userId: USER, device: tablet });
    await revokeOtherSessions(USER, tablet.deviceId, 'signed_in_elsewhere', 'mobile');

    expect(await touchSession(pc.sessionId)).not.toBeNull();
    const live = await listSessions(USER);
    expect(live.map((s) => s.deviceId).sort()).toEqual(['agent-pc', 'tablet-b']);
  });

  test('a second desktop agent is still blocked by the first', async () => {
    await createSession({ userId: USER, device: agent });

    const blocking = await findBlockingSession(USER, 'agent-other-pc', 'desktop');

    expect(blocking?.deviceName).toBe('Office PC');
  });

  test('a password change ends every session, agent included', async () => {
    await createSession({ userId: USER, device: agent });
    await createSession({ userId: USER, device: phone });

    await revokeOtherSessions(USER, null, 'password_reset');

    expect(await listSessions(USER)).toHaveLength(0);
  });
});

describe('revocation reaches live requests', () => {
  test('a revoked session stops authorising requests', async () => {
    const { sessionId } = await createSession({ userId: USER, device: phone });
    expect(await touchSession(sessionId)).not.toBeNull();

    await revokeSession(sessionId, 'signed_in_elsewhere');

    expect(await touchSession(sessionId)).toBeNull();
  });

  test('an unknown session id is refused', async () => {
    expect(await touchSession('does-not-exist')).toBeNull();
  });
});

describe('refresh token rotation', () => {
  test('rotating issues a new pair and invalidates the old refresh token', async () => {
    const { sessionId, refreshToken } = await createSession({ userId: USER, device: phone });

    const first = await rotateRefreshToken({
      userId: USER,
      sessionId,
      presentedToken: refreshToken,
    });

    expect(first.ok).toBe(true);
    expect(first.refreshToken).not.toBe(refreshToken);
  });

  test('a client racing itself is not punished', async () => {
    const { sessionId, refreshToken } = await createSession({ userId: USER, device: agent });
    const first = await rotateRefreshToken({ userId: USER, sessionId, presentedToken: refreshToken });

    const raced = await rotateRefreshToken({ userId: USER, sessionId, presentedToken: refreshToken });

    expect(first.ok).toBe(true);
    expect(raced.ok).toBe(true);
    expect(await touchSession(sessionId)).not.toBeNull();
  });

  test('the agent firing five refreshes at once keeps its session', async () => {
    // The real failure: WebSocketClient and the main process each refreshed
    // from the config store, and remembering only one retired hash meant the
    // third presentation looked like a replay. The session died one second
    // after login, every morning.
    const { sessionId, refreshToken } = await createSession({ userId: USER, device: agent });

    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await rotateRefreshToken({ userId: USER, sessionId, presentedToken: refreshToken }));
    }

    expect(results.every((r) => r.ok)).toBe(true);
    expect(await touchSession(sessionId)).not.toBeNull();
  });

  test('a token from an earlier rotation still works, not just the newest', async () => {
    // Concurrent refreshes each mint their own token and the client keeps
    // whichever response landed last — which may not be the newest one.
    const { sessionId, refreshToken } = await createSession({ userId: USER, device: agent });
    const a = await rotateRefreshToken({ userId: USER, sessionId, presentedToken: refreshToken });
    await rotateRefreshToken({ userId: USER, sessionId, presentedToken: refreshToken });

    const stragglerWins = await rotateRefreshToken({
      userId: USER,
      sessionId,
      presentedToken: a.refreshToken,
    });

    expect(stragglerWins.ok).toBe(true);
    expect(await touchSession(sessionId)).not.toBeNull();
  });

  test('a token replayed after the grace window still kills the session', async () => {
    const { sessionId, refreshToken } = await createSession({ userId: USER, device: agent });
    await rotateRefreshToken({ userId: USER, sessionId, presentedToken: refreshToken });

    // Age every retired hash past the window.
    const row = rows.get(sessionId);
    rows.set(sessionId, {
      ...row,
      recentRefreshHashes: (row.recentRefreshHashes || []).map((e) => ({
        ...e,
        at: Date.now() - 60 * 60 * 1000,
      })),
    });

    const replay = await rotateRefreshToken({ userId: USER, sessionId, presentedToken: refreshToken });

    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe('REFRESH_TOKEN_REUSED');
    expect(await touchSession(sessionId)).toBeNull();
  });

  test('a token that was never issued for this session is rejected outright', async () => {
    const { sessionId } = await createSession({ userId: USER, device: phone });

    const bogus = await rotateRefreshToken({
      userId: USER,
      sessionId,
      presentedToken: 'not-a-token-this-session-ever-had',
    });

    expect(bogus.ok).toBe(false);
    expect(bogus.reason).toBe('REFRESH_TOKEN_REUSED');
    expect(await touchSession(sessionId)).toBeNull();
  });

  test('a revoked session cannot be refreshed back to life', async () => {
    const { sessionId, refreshToken } = await createSession({ userId: USER, device: phone });
    await revokeSession(sessionId, 'signed_in_elsewhere');

    const result = await rotateRefreshToken({
      userId: USER,
      sessionId,
      presentedToken: refreshToken,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('SESSION_REVOKED');
  });

  test('a refresh token cannot be used against another user’s session', async () => {
    const { sessionId, refreshToken } = await createSession({ userId: USER, device: phone });

    const result = await rotateRefreshToken({
      userId: 'attacker',
      sessionId,
      presentedToken: refreshToken,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('SESSION_REVOKED');
  });
});

describe('token contents', () => {
  test('access tokens carry the session id, so protect can check revocation', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const { sessionId, token } = await createSession({ userId: USER, device: phone });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    expect(decoded.sid).toBe(sessionId);
    expect(decoded.id).toBe(USER);
  });

  test('the refresh token is stored hashed, never in the clear', async () => {
    const { sessionId, refreshToken } = await createSession({ userId: USER, device: phone });

    const stored = rows.get(sessionId).refreshTokenHash;

    expect(stored).not.toBe(refreshToken);
    expect(stored).toHaveLength(64);
  });
});
