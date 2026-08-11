/**
 * The translation bundles that are actually compiled into the app.
 *
 * Metro cannot resolve a dynamic `require(\`./locales/${code}.json\`)`, so every
 * language has to be imported by name here. Adding a language is therefore two
 * edits: drop `locales/<code>.json` in, and add the pair below.
 *
 * `availableLanguages()` intersects this map with the catalogue in
 * languages.ts, so a language can never reach the picker without a bundle
 * behind it — being offered a language that silently renders English is the
 * failure that intersection prevents.
 */
import en from './locales/en.json';
import hi from './locales/hi.json';
import bn from './locales/bn.json';
import mr from './locales/mr.json';
import te from './locales/te.json';
import ta from './locales/ta.json';
import gu from './locales/gu.json';
import kn from './locales/kn.json';
import ml from './locales/ml.json';
import pa from './locales/pa.json';
import odia from './locales/or.json';
import assamese from './locales/as.json';
import ar from './locales/ar.json';

// `or` and `as` are TypeScript keywords, so the Odia and Assamese bundles are
// bound to spelled-out names and mapped back to their language codes below.
export const resources = {
  en: { translation: en },
  hi: { translation: hi },
  bn: { translation: bn },
  mr: { translation: mr },
  te: { translation: te },
  ta: { translation: ta },
  gu: { translation: gu },
  kn: { translation: kn },
  ml: { translation: ml },
  pa: { translation: pa },
  or: { translation: odia },
  as: { translation: assamese },
  ar: { translation: ar },
};

/** Codes with a bundle compiled in. */
export const BUNDLED_LANGUAGES: ReadonlySet<string> = new Set(Object.keys(resources));
