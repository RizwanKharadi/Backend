const { readTokenExpiry, tokenExpiresWithin } = require('../tokenExpiry');

const makeToken = (payload) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

describe('tokenExpiry', () => {
  const now = 1_700_000_000_000;

  test('reads exp from a JWT payload', () => {
    expect(readTokenExpiry(makeToken({ exp: 123 }))).toBe(123);
  });

  test('returns null for missing or malformed tokens', () => {
    expect(readTokenExpiry('')).toBeNull();
    expect(readTokenExpiry('not-a-jwt')).toBeNull();
    expect(readTokenExpiry('a.!!!.c')).toBeNull();
    expect(readTokenExpiry(makeToken({ id: 1 }))).toBeNull();
  });

  test('a token with plenty of life left does not need refreshing', () => {
    const token = makeToken({ exp: Math.floor(now / 1000) + 25 * 60 });
    expect(tokenExpiresWithin(token, 2 * 60 * 1000, now)).toBe(false);
  });

  test('a token about to expire, or already expired, needs refreshing', () => {
    expect(tokenExpiresWithin(makeToken({ exp: Math.floor(now / 1000) + 60 }), 2 * 60 * 1000, now)).toBe(true);
    expect(tokenExpiresWithin(makeToken({ exp: Math.floor(now / 1000) - 60 }), 2 * 60 * 1000, now)).toBe(true);
  });

  test('an undecodable token is treated as needing a refresh', () => {
    expect(tokenExpiresWithin('garbage', 2 * 60 * 1000, now)).toBe(true);
  });
});
