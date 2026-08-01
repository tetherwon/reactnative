/**
 * ATT(App Tracking Transparency) 권한 요청 — iOS 전용.
 *
 * iOS 14.5+ 에서는 이 권한을 허용받지 못하면 IDFA가 전부 0으로 나간다. 그러면
 * - AdMob은 비개인화 광고만 내보내 eCPM이 크게 떨어지고,
 * - 애드팝콘 오퍼월은 전환(리워드) 매칭이 IDFA에 의존해 지급이 어긋날 수 있다.
 *
 * ⚠️ 콜드스타트에 바로 띄우지 않는다. AppLockGate가 같은 시점에 Face ID 프롬프트를
 * 띄우기 때문에 두 시스템 다이얼로그가 겹치면 한쪽이 조용히 무시된다. 그래서 광고를
 * 실제로 쓰기 직전(보상형 광고·오퍼월 진입)에 요청한다 — 애플이 권장하는 '맥락 있는
 * 요청'이기도 해서 허용률도 더 높다.
 *
 * 권한 상태는 한 번 정해지면 앱 재설치 전까지 바뀌지 않으므로 결과를 메모이즈한다.
 * 실패/미지원은 전부 false — 광고 자체는 비개인화로 계속 동작하므로 절대 던지지 않는다.
 */
import { AppState, Platform } from 'react-native';

type TrackingModule = typeof import('expo-tracking-transparency');

let mod: TrackingModule | null | undefined;

function getModule(): TrackingModule | null {
  if (mod === undefined) {
    try {
      // 이 네이티브 모듈이 없는 구버전 바이너리가 OTA로 이 코드를 받아도
      // import 시점에 죽지 않도록 require를 감싼다. (admob.ts와 같은 이유)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('expo-tracking-transparency') as TrackingModule;
    } catch {
      mod = null;
    }
  }
  return mod;
}

/** 앱이 foreground(active)가 될 때까지 기다린다. */
function waitForActive(): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve) => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        sub.remove();
        resolve();
      }
    });
  });
}

let pending: Promise<boolean> | null = null;

/**
 * ATT 권한을 (필요하면) 요청하고 추적 허용 여부를 돌려준다.
 * 여러 번 불러도 실제 요청은 한 번만 나간다.
 */
export function ensureTrackingPermissionAsync(): Promise<boolean> {
  if (Platform.OS !== 'ios') return Promise.resolve(false);
  if (pending) return pending;

  pending = (async () => {
    const m = getModule();
    if (!m) return false;
    try {
      const current = await m.getTrackingPermissionsAsync();
      if (current.status === 'granted') return true;
      // 이미 거부했거나 '요청 불가'(기기 정책 등)면 다시 물어도 프롬프트가 뜨지 않는다.
      if (!current.canAskAgain) return false;

      // 시스템 프롬프트는 앱이 active일 때만 뜬다. 백그라운드에서 부르면
      // 프롬프트 없이 즉시 denied로 확정돼 버려 기회를 영영 잃는다.
      await waitForActive();

      const result = await m.requestTrackingPermissionsAsync();
      return result.status === 'granted';
    } catch {
      return false;
    }
  })();

  return pending;
}
