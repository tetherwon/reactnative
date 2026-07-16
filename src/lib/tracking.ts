/**
 * iOS ATT(앱 추적 투명성) 권한 요청.
 *
 * AdMob(보상형 광고)과 애드팝콘(오퍼월) 둘 다 IDFA를 쓰므로, 권한 없이는
 * 광고 수익·오퍼월 참여 추적이 부정확해진다. 앱 시작 시 불쑥 묻는 대신
 * 첫 광고/오퍼월 진입 직전에 물어 "왜 묻는지"가 맥락상 자연스럽게 보이게 한다.
 * (문구는 app.config.js의 expo-tracking-transparency 플러그인 설정)
 *
 * admob.ts와 동일하게, 모듈이 없는 바이너리(구버전 앱)에서 import 시점에
 * 죽지 않도록 require를 try/catch로 감싼다. Android는 ATT 개념이 없어 no-op.
 */
import { Platform } from 'react-native';

let requested: Promise<void> | null = null;

export function ensureTrackingPermissionAsync(): Promise<void> {
  if (Platform.OS !== 'ios') return Promise.resolve();
  if (!requested) {
    requested = (async () => {
      try {
        const { requestTrackingPermissionsAsync } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('expo-tracking-transparency') as typeof import('expo-tracking-transparency');
        await requestTrackingPermissionsAsync();
      } catch {
        // 모듈 없음/요청 실패 — 추적 없이 진행 (광고는 비개인화로 동작)
      }
    })();
  }
  return requested;
}
