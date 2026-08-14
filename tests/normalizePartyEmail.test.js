/**
 * Party email normalisation must be linear in the length of its input.
 *
 * The original pattern, `^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$`, contains
 * nested quantifiers: `\w+([.-]?\w+)*` can split a run of word characters in
 * exponentially many ways, and the engine tries every one before rejecting a
 * string that does not match. One ledger with a ~40-character near-miss in its
 * email field pinned the event loop at 100% CPU for minutes — the backend
 * stopped answering agent sync, mobile and logins alike, and because the
 * process was alive PM2 never restarted it.
 *
 * These tests are as much about the time limit as the return value.
 */
import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const { default: service } = await import('../src/services/tallyWebSocketService.js');

const normalize = (raw) => service.normalizePartyEmail(raw);

describe('normalizePartyEmail', () => {
  test('keeps a valid address', () => {
    expect(normalize('Accounts@Example.COM')).toBe('accounts@example.com');
    expect(normalize('a.b-c@sub.example.co.in')).toBe('a.b-c@sub.example.co.in');
  });

  test('rejects rubbish', () => {
    expect(normalize('not-an-email')).toBe('');
    expect(normalize('no@tld')).toBe('');
    expect(normalize('two words@example.com')).toBe('');
    expect(normalize('')).toBe('');
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });

  test('returns immediately on the input that used to hang the server', () => {
    // Under the old pattern this single call never returned.
    const evil = `${'a'.repeat(30)}@${'b'.repeat(30)}!`;

    const started = Date.now();
    const result = normalize(evil);

    expect(result).toBe('');
    expect(Date.now() - started).toBeLessThan(50);
  });

  test('stays fast as the near-miss grows, rather than doubling each time', () => {
    // Exponential backtracking shows up as time roughly doubling per added
    // character. Linear matching barely moves.
    const timeFor = (n) => {
      const started = Date.now();
      normalize(`${'a'.repeat(n)}@${'b'.repeat(n)}!`);
      return Date.now() - started;
    };

    timeFor(10); // warm up
    expect(timeFor(40)).toBeLessThan(50);
    expect(timeFor(80)).toBeLessThan(50);
  });

  test('an absurdly long value is refused outright', () => {
    const started = Date.now();

    expect(normalize(`${'a'.repeat(50000)}@example.com`)).toBe('');
    expect(Date.now() - started).toBeLessThan(50);
  });
});
