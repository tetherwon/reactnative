import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// 햅틱은 iOS/Android 실기기에서만 의미가 있다.
// 웹이나 미지원 환경에서 호출돼도 앱이 죽지 않도록 안전하게 감싼다.
const supported = Platform.OS === 'ios' || Platform.OS === 'android';

/** 가벼운 탭 피드백 (버튼 등).
 *  일상 탭/네비게이션마다 진동이 울려 과하다는 피드백으로 비활성화했다.
 *  의미 있는 순간은 success()/error()가 담당한다. 호출부(55곳)는 그대로
 *  둬도 되도록 시그니처는 유지 — 다시 켜려면 아래 본문을 복구한다. */
export async function tap(): Promise<void> {
  return;
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
