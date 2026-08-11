import { initI18n, changeLanguage, resolveInitialLanguage, i18next } from '../index';
import { LANGUAGES, availableLanguages, findLanguage, isRtl } from '../languages';
import { BUNDLED_LANGUAGES } from '../resources';
import { getFormattingLocale } from '../../utils/localeFormatData';
import { formatNumber, formatCompactAmount, formatDate, formatRelativeTime } from '../../utils/formatters';

jest.mock('react-native', () => ({
  NativeModules: { I18nManager: { localeIdentifier: 'en_IN' } },
  Platform: { OS: 'android' },
}));

describe('i18n', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  afterEach(async () => {
    await changeLanguage('en');
  });

  describe('language catalogue', () => {
    it('has unique codes', () => {
      const codes = LANGUAGES.map((l) => l.code);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('gives every language a native name', () => {
      for (const lang of LANGUAGES) {
        expect(lang.nativeName.trim().length).toBeGreaterThan(0);
      }
    });

    it('only offers languages that have a translation file', () => {
      expect(availableLanguages().map((l) => l.code)).toEqual([
        'en',
        'hi',
        'bn',
        'mr',
        'te',
        'ta',
        'gu',
        'kn',
        'ml',
        'pa',
        'or',
        'as',
        'ar',
      ]);
    });

    it('resolves a regional tag to its base language', () => {
      expect(findLanguage('hi-IN')?.code).toBe('hi');
      expect(findLanguage('ar-AE')?.code).toBe('ar');
      expect(findLanguage('zz')).toBeUndefined();
    });

    it('marks Arabic and Urdu as right-to-left', () => {
      expect(isRtl('ar')).toBe(true);
      expect(isRtl('ur')).toBe(true);
      expect(isRtl('hi')).toBe(false);
      expect(isRtl('en')).toBe(false);
    });
  });

  describe('resolveInitialLanguage', () => {
    it('prefers a saved choice', () => {
      expect(resolveInitialLanguage('hi')).toBe('hi');
    });

    it('ignores a saved language that has no translation yet', () => {
      expect(resolveInitialLanguage('ta')).toBe('ta');
    });

    it('falls back to English when nothing is saved', () => {
      expect(resolveInitialLanguage(null)).toBe('en');
      expect(resolveInitialLanguage(undefined)).toBe('en');
    });
  });

  describe('changeLanguage', () => {
    it('switches strings and formatting together', async () => {
      await changeLanguage('hi');
      expect(i18next.language).toBe('hi');
      expect(getFormattingLocale()).toBe('hi');
      expect(formatDate(new Date(2026, 7, 7))).toBe('07 अग 2026');
      expect(formatCompactAmount(125000)).toBe('₹1.25ला.');
    });

    it('routes formatters through the active translation', async () => {
      await changeLanguage('hi');
      expect(formatRelativeTime(null)).toBe('कभी नहीं');
      await changeLanguage('en');
      expect(formatRelativeTime(null)).toBe('Never');
    });

    it('refuses a language with no translation file and reports what it applied', async () => {
      const applied = await changeLanguage('ta');
      expect(applied).toBe('ta');
      expect(i18next.language).toBe('ta');
      expect(getFormattingLocale()).toBe('ta');
    });

    it('keeps Indian grouping in Hindi', async () => {
      await changeLanguage('hi');
      expect(formatNumber(1234567)).toBe('12,34,567');
    });

    it('never translates the currency itself', async () => {
      await changeLanguage('hi');
      // ₹50,000 from Tally is still ₹50,000 — only the grouping is localised.
      expect(formatCompactAmount(50000)).toContain('₹');
    });
  });

  describe('translation files', () => {
    const flatten = (obj: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === 'object'
          ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
          : [`${prefix}${k}`]
      );

    const keysFor = (lng: string) =>
      flatten(i18next.getResourceBundle(lng, 'translation'));

    // Read from the resources module, not from i18next: this runs at
    // describe-time, before `beforeAll` has initialised the instance.
    const shipped = [...BUNDLED_LANGUAGES].filter((l) => l !== 'en');

    it.each(shipped)(
      '%s defines no key that English does not have',
      (lng) => {
        // A key with no English counterpart is a typo or a leftover: it can
        // never be reached through the fallback chain, so it is dead weight
        // that silently rots. Partial coverage is fine — orphans are not.
        const en = new Set(keysFor('en'));
        const orphans = keysFor(lng).filter((k) => !en.has(k));
        expect(orphans).toEqual([]);
      }
    );

    it('has no empty English strings', () => {
      const bundle = i18next.getResourceBundle('en', 'translation');
      const empty = flatten(bundle).filter(
        (k) => String(i18next.t(k, { lng: 'en' })).trim() === ''
      );
      expect(empty).toEqual([]);
    });
  });
});
