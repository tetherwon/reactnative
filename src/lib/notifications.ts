import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// 앱이 포그라운드(켜져 있는 상태)일 때도 배너/목록/소리/뱃지로 알림을 표시
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// EAS 프로젝트 ID 가져오기 (`eas init` 시 app.json의 extra.eas.projectId 로 주입됨)
function resolveProjectId(): string | undefined {
  return (
    Constants?.expoConfig?.extra?.eas?.projectId ??
    Constants?.easConfig?.projectId
  );
}

// ───────────────────────────────────────────────────────────────
// 백엔드 연동 지점.
// 백엔드 담당자에게서 "토큰 등록 API" URL 을 받으면 여기만 채우면 된다.
// (docs/BACKEND.md 의 요청 형식과 동일하게 맞춰져 있음)
// 비어 있으면 전송을 생략하고 콘솔에만 토큰을 출력한다.
const PUSH_TOKEN_ENDPOINT = '';

async function sendTokenToBackend(token: string): Promise<void> {
  if (!PUSH_TOKEN_ENDPOINT) {
    console.log('[push] (백엔드 엔드포인트 미설정) Expo push token:', token);
    return;
  }
  try {
    const res = await fetch(PUSH_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        platform: Platform.OS,
        deviceName: Device.deviceName ?? null,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log('[push] 토큰을 백엔드로 전송했습니다.');
  } catch (e) {
    console.warn('[push] 토큰 전송 실패:', e);
  }
}

/**
 * 푸시 알림 권한을 요청하고 Expo 푸시 토큰을 발급받는다.
 * - 안드로이드: 토큰 발급 전에 알림 채널 등록 필요
 * - 원격 푸시 토큰은 "실제 기기"에서만 발급 가능 (시뮬레이터/에뮬레이터 불가)
 * - Expo Go(SDK 53+)에서는 원격 푸시 미지원 → development build 필요
 *
 * @returns Expo 푸시 토큰 문자열, 실패 시 null
 */
async function ensurePermissionAsync(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: '기본 알림',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#208AEF',
    });
  }

  if (!Device.isDevice) {
    console.warn('[push] 실제 기기에서만 푸시 토큰을 받을 수 있습니다.');
    return false;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('[push] 알림 권한이 거부되었습니다.');
    return false;
  }
  return true;
}

// iOS의 FCM 등록 토큰은 Firebase Messaging SDK로만 발급된다 —
// expo-notifications의 getDevicePushTokenAsync()는 iOS에서 raw APNs 토큰을
// 돌려주는데, 서버(FCM v1 API)는 그걸 못 쓴다. admob.ts와 동일하게, 모듈이
// 없는 바이너리(구버전 앱·GoogleService-Info.plist 없는 빌드)에서 import
// 시점에 죽지 않도록 require를 try/catch로 감싼다.
type FirebaseMessaging = typeof import('@react-native-firebase/messaging');

let fbMessaging: FirebaseMessaging | null | undefined;

function getFirebaseMessaging(): FirebaseMessaging | null {
  if (fbMessaging === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      fbMessaging = require('@react-native-firebase/messaging') as FirebaseMessaging;
    } catch {
      fbMessaging = null;
    }
  }
  return fbMessaging;
}

/**
 * 웹(native-push.js)의 {type:"push:getToken"} 요청에 응답할 FCM 기기 토큰.
 * 서버(/api/push/fcm/register → FCM v1 API)가 raw FCM 토큰을 기대하므로
 * Expo 푸시 토큰이 아니라 FCM 등록 토큰을 발급한다.
 * - Android: expo-notifications의 getDevicePushTokenAsync() (= FCM 토큰).
 *   google-services.json 없이 빌드된 바이너리에서는 발급이 실패한다 → null.
 * - iOS: Firebase Messaging의 getToken(). GoogleService-Info.plist 없이
 *   빌드됐거나(FIRApp 미초기화) 시뮬레이터면 발급이 실패한다 → null.
 */
export async function getFcmDeviceTokenAsync(): Promise<string | null> {
  if (!(await ensurePermissionAsync())) return null;

  if (Platform.OS === 'android') {
    try {
      const { data } = await Notifications.getDevicePushTokenAsync();
      return typeof data === 'string' && data.length > 0 ? data : null;
    } catch (e) {
      console.warn('[push] FCM 기기 토큰 발급 실패:', e);
      return null;
    }
  }

  const m = getFirebaseMessaging();
  if (!m) return null;
  try {
    const messaging = m.getMessaging();
    // APNs 등록이 선행돼야 FCM 토큰이 나온다(이미 등록돼 있으면 no-op).
    await m.registerDeviceForRemoteMessages(messaging);
    const token = await m.getToken(messaging);
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch (e) {
    console.warn('[push] FCM 기기 토큰 발급 실패:', e);
    return null;
  }
}

/**
 * FCM 토큰 갱신 구독. 해제 함수를 돌려준다.
 * (index.tsx가 갱신 시 웹에 재등록시키는 데 쓴다)
 */
export function addFcmTokenRefreshListener(onRefresh: () => void): () => void {
  if (Platform.OS === 'android') {
    const sub = Notifications.addPushTokenListener(onRefresh);
    return () => sub.remove();
  }
  const m = getFirebaseMessaging();
  if (!m) return () => {};
  try {
    return m.onTokenRefresh(m.getMessaging(), onRefresh);
  } catch {
    // FIRApp 미초기화(plist 없는 빌드) 등 — 구독 없이 진행
    return () => {};
  }
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!(await ensurePermissionAsync())) return null;

  const projectId = resolveProjectId();
  if (!projectId) {
    console.warn(
      '[push] projectId 가 없습니다. `eas init` 을 실행하거나 app.json 의 extra.eas.projectId 를 설정하세요.',
    );
    return null;
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await sendTokenToBackend(token);
    return token;
  } catch (e) {
    console.warn('[push] 푸시 토큰 발급 실패:', e);
    return null;
  }
}
