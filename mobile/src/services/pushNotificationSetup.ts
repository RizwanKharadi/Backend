import { Platform } from 'react-native';
import PushNotification, { Importance } from 'react-native-push-notification';
import PushNotificationIOS from '@react-native-community/push-notification-ios';

let configured = false;

/**
 * Configure local/remote notification channels (Android) and iOS permissions.
 * Safe to call multiple times; runs once per app session.
 */
export const configurePushNotifications = (): void => {
  if (configured) {
    return;
  }

  PushNotification.configure({
    onRegister(token) {
      if (__DEV__) {
        console.log('Push notification token:', token);
      }
    },
    onNotification(notification) {
      if (Platform.OS === 'ios') {
        notification.finish(PushNotificationIOS.FetchResult.NoData);
      }
    },
    permissions: {
      alert: true,
      badge: true,
      sound: true,
    },
    popInitialNotification: true,
    requestPermissions: Platform.OS === 'ios',
  });

  if (Platform.OS === 'android') {
    PushNotification.createChannel(
      {
        channelId: 'finsync360-default',
        channelName: 'TallyFin Notifications',
        channelDescription: 'Sync and business alerts',
        playSound: true,
        soundName: 'default',
        importance: Importance.HIGH,
        vibrate: true,
      },
      () => {},
    );
  }

  configured = true;
};
