import { resolveLocalhostForDevice } from './devHost';

/**
 * Endpoint resolution shared by the REST client and the WebSocket client.
 *
 * The env values are inlined at build time by react-native-dotenv, which reads
 * whichever file babel.config.js selects. If a development .env is present when
 * a release APK is bundled, the APK ships pointing at localhost — on a phone
 * that means every request fails with "check if your backend server is
 * running", with no clue that the URL is the problem. A release build has no
 * legitimate reason to talk to localhost, so we refuse it and fall back.
 */

export const PRODUCTION_API_URL = 'https://api.aiminfocom.com/api';
export const PRODUCTION_WS_URL = 'wss://api.aiminfocom.com';

const LOCAL_HOST_PATTERN = /^[a-z]+:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|0\.0\.0\.0)(:\d+)?(\/|$)/i;

export function isLocalUrl(url?: string): boolean {
  return !!url && LOCAL_HOST_PATTERN.test(url);
}

/**
 * @param envUrl    value inlined from the env file (may be empty/undefined)
 * @param fallback  production endpoint to use when envUrl is missing or unusable
 * @param label     name used in the warning, e.g. "API_BASE_URL"
 */
export function resolveEndpoint(
  envUrl: string | undefined,
  fallback: string,
  label: string
): string {
  const value = (envUrl || '').trim();

  if (!__DEV__ && isLocalUrl(value)) {
    console.warn(
      `[${label}] release build was given a local URL (${value}); ` +
        `falling back to ${fallback}. Rebuild with .env.production to silence this.`
    );
    return fallback;
  }

  // Dev keeps the emulator rewrite (localhost -> 10.0.2.2).
  return resolveLocalhostForDevice(value || fallback);
}
