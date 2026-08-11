import fs from 'fs';
import path from 'path';
import en from '../locales/en.json';
import { initI18n, i18next } from '../index';

jest.mock('react-native', () => ({
  NativeModules: { I18nManager: { localeIdentifier: 'en_IN' } },
  Platform: { OS: 'android' },
}));

/**
 * Guards the string-extraction work that is still in progress.
 *
 * Every `t('some.key')` in the source has to resolve to something in en.json.
 * A typo'd or forgotten key does not throw at runtime — i18next just renders
 * the key itself, so "settings.biomteric.title" ships to a user as that literal
 * text. This test is the only thing that catches it.
 */

const SRC = path.join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

function flatten(obj: Record<string, unknown>, prefix = ''): Set<string> {
  const keys = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') {
      for (const nested of flatten(v as Record<string, unknown>, `${prefix}${k}.`)) {
        keys.add(nested);
      }
    } else {
      keys.add(`${prefix}${k}`);
    }
  }
  return keys;
}

const defined = flatten(en as unknown as Record<string, unknown>);

function isDefined(key: string): boolean {
  return defined.has(key);
}

describe('translation key coverage', () => {
  const files = walk(SRC);

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('every t() and tSafe() key used in source exists in en.json', () => {
    // Literal keys only. A computed key (t(action.labelKey)) cannot be checked
    // statically; those are covered by the defaults living in en.json anyway.
    const callPattern = /\b(?:t|tSafe)\(\s*'([a-zA-Z][\w.]*)'/g;
    const missing: string[] = [];

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      let match: RegExpExecArray | null;
      while ((match = callPattern.exec(source)) !== null) {
        const key = match[1];
        // A key with no dot is almost certainly not a translation key
        // (e.g. a local helper called `t`), so skip those.
        if (!key.includes('.')) continue;
        if (!isDefined(key)) {
          missing.push(`${path.relative(SRC, file).replace(/\\/g, '/')} → ${key}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('every key used in source actually RESOLVES at runtime', async () => {
    // Existence in en.json is not enough. Plural keys only resolve if their
    // suffixes match the configured `compatibilityJSON` scheme — v3 wants
    // `key` + `key_plural`, v4 wants `key_one` + `key_other`. Get that wrong
    // and i18next silently renders the raw key ("dashboard.invoiceCount") to
    // the user. Nothing but resolving the key catches it.
    await initI18n('en');

    const callPattern = /\b(?:t|tSafe)\(\s*'([a-zA-Z][\w.]*)'/g;
    const unresolved: string[] = [];

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      let match: RegExpExecArray | null;
      while ((match = callPattern.exec(source)) !== null) {
        const key = match[1];
        if (!key.includes('.')) continue;
        // Try both a plural and a singular count so plural keys are exercised.
        for (const count of [1, 5]) {
          const rendered = String(i18next.t(key, { count } as never));
          if (rendered === key) {
            unresolved.push(
              `${path.relative(SRC, file).replace(/\\/g, '/')} → ${key} (count=${count})`
            );
          }
        }
      }
    }

    expect([...new Set(unresolved)]).toEqual([]);
  });

  it('defines no key that is never used', () => {
    // Unused keys are dead weight that drifts out of sync with the UI. The
    // exceptions are keys reached only through a computed lookup.
    const computedPrefixes = [
      'dashboard.quickAction.',
      'vouchers.status.',
      'settings.themeName.',
      'inventory.filters.',
      'common.',
    ];

    const allSource = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const unused = [...defined]
      // A `_plural` variant is reached through its base key plus a count, so
      // it is used even though that exact string never appears in source.
      .map((k) => k.replace(/_(plural|[0-5])$/, ''))
      .filter((k) => !computedPrefixes.some((p) => k.startsWith(p)))
      .filter((k) => !allSource.includes(`'${k}'`));

    expect([...new Set(unused)]).toEqual([]);
  });
});
