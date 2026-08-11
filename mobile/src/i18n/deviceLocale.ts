/**
 * The device's language, read from React Native's own native modules.
 *
 * Deliberately not using react-native-localize: it is a native dependency, and
 * adding one forces every developer and every CI job to rebuild the Android and
 * iOS apps. The two values below are already exposed by React Native itself and
 * are all we need — a language tag such as 'hi-IN'.
 */
import { NativeModules, Platform } from 'react-native';

export function getDeviceLanguage(): string {
  try {
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings;
      const locale: string | undefined =
        settings?.AppleLocale || settings?.AppleLanguages?.[0];
      return normalize(locale);
    }
    return normalize(NativeModules.I18nManager?.localeIdentifier);
  } catch {
    // A missing native module must never stop the app from starting.
    return 'en';
  }
}

/** 'hi_IN' / 'hi-IN' → 'hi'. */
function normalize(raw: string | undefined | null): string {
  if (!raw) return 'en';
  const tag = String(raw).replace(/_/g, '-');
  return tag.split('-')[0].toLowerCase() || 'en';
}
