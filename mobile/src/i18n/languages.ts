/**
 * Every language the app is planned to ship in.
 *
 * A language appears in the Settings picker only once `ready` is true, which
 * means a reviewed translation file exists for it. Listing a language here
 * before it is ready is deliberate: it keeps the catalogue (native names,
 * grouping style, script direction) in one reviewed place while the strings are
 * still being translated.
 */
import type { LocaleFormatData } from '../utils/localeFormatData';
import { BUNDLED_LANGUAGES } from './resources';

export interface LanguageDefinition {
  /** BCP-47 tag, also the translation file name. */
  code: string;
  /** English name, for our own logs and docs. */
  englishName: string;
  /** Name in the language itself — what the picker shows. */
  nativeName: string;
  /** Right-to-left script. */
  rtl: boolean;
  /** A reviewed translation file exists and the language is user-selectable. */
  ready: boolean;
  /** Overrides on top of the English formatting tables. */
  format: Partial<LocaleFormatData>;
}

/**
 * Indian languages all use Indian digit grouping (12,34,567) and the
 * lakh/crore compact scale. Arabic uses western grouping and has no lakh, so it
 * abbreviates in millions instead.
 */
const INDIAN_FORMAT: Partial<LocaleFormatData> = {
  grouping: 'indian',
  compact: 'indian',
};

const GULF_FORMAT: Partial<LocaleFormatData> = {
  grouping: 'western',
  compact: 'western',
};

export const LANGUAGES: LanguageDefinition[] = [
  {
    code: 'en',
    englishName: 'English',
    nativeName: 'English',
    rtl: false,
    ready: true,
    format: INDIAN_FORMAT,
  },
  {
    code: 'hi',
    englishName: 'Hindi',
    nativeName: 'हिन्दी',
    rtl: false,
    ready: true,
    format: {
      ...INDIAN_FORMAT,
      months: ['जन', 'फ़र', 'मार्च', 'अप्रै', 'मई', 'जून', 'जुल', 'अग', 'सित', 'अक्तू', 'नव', 'दिस'],
      monthsLong: [
        'जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून',
        'जुलाई', 'अगस्त', 'सितंबर', 'अक्तूबर', 'नवंबर', 'दिसंबर',
      ],
      weekdays: ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'],
      compactSuffixes: {
        crore: 'क.',
        lakh: 'ला.',
        thousand: 'ह.',
        million: 'मि.',
        billion: 'अ.',
      },
    },
  },
  // --- Planned. Flip `ready` once a reviewed translation file lands. ---
  { code: 'bn', englishName: 'Bengali', nativeName: 'বাংলা', rtl: false, ready: true, format: INDIAN_FORMAT },
  { code: 'mr', englishName: 'Marathi', nativeName: 'मराठी', rtl: false, ready: true, format: INDIAN_FORMAT },
  { code: 'te', englishName: 'Telugu', nativeName: 'తెలుగు', rtl: false, ready: true, format: INDIAN_FORMAT },
  { code: 'ta', englishName: 'Tamil', nativeName: 'தமிழ்', rtl: false, ready: true, format: INDIAN_FORMAT },
  { code: 'gu', englishName: 'Gujarati', nativeName: 'ગુજરાતી', rtl: false, ready: true, format: INDIAN_FORMAT },
  { code: 'kn', englishName: 'Kannada', nativeName: 'ಕನ್ನಡ', rtl: false, ready: true, format: INDIAN_FORMAT },
  { code: 'ml', englishName: 'Malayalam', nativeName: 'മലയാളം', rtl: false, ready: true, format: INDIAN_FORMAT },
  { code: 'pa', englishName: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', rtl: false, ready: true, format: INDIAN_FORMAT },
  { code: 'or', englishName: 'Odia', nativeName: 'ଓଡ଼ିଆ', rtl: false, ready: true, format: INDIAN_FORMAT },
  { code: 'as', englishName: 'Assamese', nativeName: 'অসমীয়া', rtl: false, ready: true, format: INDIAN_FORMAT },
  // Urdu and Arabic are RTL. Enabling either needs the layout pass as well as
  // the strings — see docs/I18N.md.
  { code: 'ur', englishName: 'Urdu', nativeName: 'اردو', rtl: true, ready: false, format: INDIAN_FORMAT },
  { code: 'ar', englishName: 'Arabic', nativeName: 'العربية', rtl: true, ready: true, format: GULF_FORMAT },
];

export const DEFAULT_LANGUAGE = 'en';

/**
 * Languages the user can actually pick today.
 *
 * Both gates have to pass: `ready` is the human judgement that the translation
 * has been reviewed, and BUNDLED_LANGUAGES is the mechanical fact that a file
 * exists and is compiled in. Flipping `ready` on a language whose JSON has not
 * been added yet would otherwise put it in the picker, where choosing it falls
 * back to English with no explanation.
 */
export function availableLanguages(): LanguageDefinition[] {
  return LANGUAGES.filter((l) => l.ready && BUNDLED_LANGUAGES.has(l.code));
}

export function findLanguage(code: string): LanguageDefinition | undefined {
  const exact = LANGUAGES.find((l) => l.code === code);
  if (exact) return exact;
  const base = code.split('-')[0];
  return LANGUAGES.find((l) => l.code === base);
}

/** True when the language is reviewed AND has a bundle compiled in. */
export function isAvailable(code: string): boolean {
  const lang = findLanguage(code);
  return Boolean(lang?.ready && BUNDLED_LANGUAGES.has(lang.code));
}

export function isRtl(code: string): boolean {
  return findLanguage(code)?.rtl ?? false;
}
