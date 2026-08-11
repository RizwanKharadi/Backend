/**
 * Stable per-install identity for this device.
 *
 * The server allows one signed-in device per account, so it needs to tell "the
 * same phone signing in again" apart from "a second phone". That answer has to
 * survive app restarts, which means it is generated once and stored.
 *
 * It is deliberately not the hardware id: those are restricted on modern
 * Android and iOS, and using one would mean a reinstall inherits the previous
 * install's session. A random id per install is the honest unit here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';

const DEVICE_ID_KEY = '@tallyfin/device_id';

export interface DeviceDescriptor {
  deviceId: string;
  deviceName: string;
  platform: string;
  appVersion: string;
}

let cached: DeviceDescriptor | null = null;

const randomId = (): string => {
  // Not security-sensitive: this only has to be unique, never guessed. The
  // server binds the session to it but never trusts it as a credential.
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand()}-${rand()}`;
};

/** Best-effort human label, so "sign out my other device" names something real. */
const describeDevice = async (): Promise<string> => {
  try {
    const [brand, model] = await Promise.all([
      Promise.resolve(DeviceInfo.getBrand()),
      DeviceInfo.getDeviceName().catch(() => ''),
    ]);
    const label = [brand, model].filter(Boolean).join(' ').trim();
    return label || `${Platform.OS} device`;
  } catch {
    return `${Platform.OS} device`;
  }
};

export const getDeviceDescriptor = async (): Promise<DeviceDescriptor> => {
  if (cached) return cached;

  let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = randomId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  }

  let appVersion = '';
  try {
    appVersion = DeviceInfo.getVersion();
  } catch {
    appVersion = '';
  }

  cached = {
    deviceId,
    deviceName: await describeDevice(),
    platform: Platform.OS,
    appVersion,
  };
  return cached;
};
