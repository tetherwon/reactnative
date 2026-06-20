import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// 햅틱은 iOS/Android 실기기에서만 의미가 있다.
// 웹이나 미지원 환경에서 호출돼도 앱이 죽지 않도록 안전하게 감싼다.
const supported = Platform.OS === 'ios' || Platform.OS === 'android';

/** 가벼운 탭 피드백 (버튼 등) */
export async function tap(): Promise<void> {
  if (!supported) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // 무시
  }
}

/** 성공 피드백 (잠금 해제 성공, 알림 처리 등) */
export async function success(): Promise<void> {
  if (!supported) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // 무시
  }
}

/** 실패/경고 피드백 (인증 실패, 네트워크 오류 등) */
export async function error(): Promise<void> {
  if (!supported) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {
    // 무시
  }
}
