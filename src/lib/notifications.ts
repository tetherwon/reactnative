import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { ensureTrackingPermission } from './tracking';
import { withNativePrompt } from './nativePrompts';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true,
  }),
});

let permissionPending: Promise<boolean> | null = null;
export function ensureNotificationPermission(): Promise<boolean> {
  if (permissionPending) return permissionPending;
  permissionPending = (async () => {
    if (!Device.isDevice || (Platform.OS !== 'android' && Platform.OS !== 'ios')) return false;
    await ensureTrackingPermission();
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: '기본 알림', importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250], lightColor: '#208AEF',
      });
    }
    return withNativePrompt(async () => {
      let permission = await Notifications.getPermissionsAsync();
      if (permission.status !== 'granted' && permission.canAskAgain) {
        permission = await Notifications.requestPermissionsAsync();
      }
      return permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    });
  })().catch(() => false).finally(() => { permissionPending = null; });
  return permissionPending;
}

export type NativePushToken = { token: string; platform: 'android' | 'ios'; provider: 'fcm' | 'expo' };
let tokenPending: Promise<NativePushToken | null> | null = null;

export function getNativePushTokenAsync(): Promise<NativePushToken | null> {
  if (tokenPending) return tokenPending;
  tokenPending = (async (): Promise<NativePushToken | null> => {
    if (!(await ensureNotificationPermission())) return null;
    if (Platform.OS === 'android') {
      const { data } = await Notifications.getDevicePushTokenAsync();
      return typeof data === 'string' && data ? { token: data, platform: 'android', provider: 'fcm' } : null;
    }
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    // iOS device tokens are APNs, not FCM. Expo handles APNs delivery using EAS credentials.
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data ? { token: data, platform: 'ios', provider: 'expo' } : null;
  })().catch(() => null).finally(() => { tokenPending = null; });
  return tokenPending;
}
