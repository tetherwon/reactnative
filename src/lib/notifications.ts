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
export async function registerForPushNotificationsAsync(): Promise<string | null> {
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
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('[push] 알림 권한이 거부되었습니다.');
    return null;
  }

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
