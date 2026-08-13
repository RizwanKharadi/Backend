/**
 * $regex reaches MySQL as REGEXP, so anything a user types into a search box is
 * a pattern rather than a literal. Party names here are full of regex
 * metacharacters — "Shah & Co. (India) Pvt. Ltd." — and a search that fires as
 * you type sends half-finished text like "Acme (", which is not a valid pattern
 * and fails the whole query instead of simply matching nothing.
 */

import { escapeRegex } from '../src/db/queryUtils.js';

const matches = (pattern, text) => new RegExp(pattern, 'i').test(text);

describe('escapeRegex', () => {
  it('keeps ordinary text unchanged', () => {
    expect(escapeRegex('Sharma Traders')).toBe('Sharma Traders');
  });

  it('makes a half-typed name a valid pattern instead of a broken one', () => {
    expect(() => new RegExp('Acme (')).toThrow();
    expect(() => new RegExp(escapeRegex('Acme ('))).not.toThrow();
  });

  it.each(['(', ')', '[', ']', '{', '}', '.', '*', '+', '?', '^', '$', '|', '\\'])(
    'escapes %s so it is searched for literally',
    (char) => {
      const term = `Acme ${char} Co`;
      expect(matches(escapeRegex(term), term)).toBe(true);
    }
  );

  it('stops a dot matching any character', () => {
    // Unescaped, "Pvt." would also match "PvtX".
    expect(matches(escapeRegex('Pvt.'), 'PvtX')).toBe(false);
    expect(matches(escapeRegex('Pvt.'), 'Pvt.')).toBe(true);
  });

  it('still matches a real name containing brackets', () => {
    const name = 'Shah & Co. (India) Pvt. Ltd.';
    expect(matches(escapeRegex('(India)'), name)).toBe(true);
  });

  it('handles empty and missing input', () => {
    expect(escapeRegex('')).toBe('');
    expect(escapeRegex(null)).toBe('');
    expect(escapeRegex(undefined)).toBe('');
  });
});
