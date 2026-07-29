import { Platform } from 'react-native';

/**
 * 10.0.2.2 is the Android emulator alias for the host PC.
 * Physical devices must use localhost (with adb reverse) or your PC LAN IP in .env.
 */
export function isAndroidEmulator(): boolean {
  if (Platform.OS !== 'android') {
    return false;
  }

  const constants = Platform.constants as {
    Model?: string;
    Brand?: string;
    Fingerprint?: string;
    isDevice?: boolean;
  };

  if (constants.isDevice === false) {
    return true;
  }

  const model = constants.Model ?? '';
  const brand = constants.Brand ?? '';
  const fingerprint = constants.Fingerprint ?? '';

  return (
    /sdk|emulator|google_sdk|Android SDK built for x86|sdk_gphone/i.test(model) ||
    /generic|emulator|sdk|vbox|genymotion|ranchu|goldfish/i.test(fingerprint) ||
    (brand === 'google' && /sdk/i.test(model))
  );
}

export function resolveLocalhostForDevice(url: string): string {
  if (!/localhost|127\.0\.0\.1/i.test(url)) {
    return url;
  }

  if (Platform.OS === 'android' && isAndroidEmulator()) {
    return url.replace(/localhost|127\.0\.0\.1/gi, '10.0.2.2');
  }

  return url;
}
