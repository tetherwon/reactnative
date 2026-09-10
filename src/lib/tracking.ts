/**
 * App Tracking Transparency (iOS 14.5+).
 *
 * 이 앱은 AdMob 보상형 광고와 애드팝콘 오퍼월을 쓴다. 두 SDK 모두 IDFA를
 * 읽을 수 있으므로, 애플 규정상 "추적 데이터를 만지기 전에" ATT 동의를
 * 먼저 물어야 한다. 예전엔 Info.plist의 NSUserTrackingUsageDescription 만
 * 넣어두고 정작 요청을 부르는 코드가 없어서 팝업이 한 번도 뜨지 않았고,
 * 애플 심사에서 그 이유로 리젝(2.1)을 받았다.
 *
 * 호출 타이밍이 중요하다. 앱이 아직 active 가 아닐 때(=스플래시·시작 직후)
 * 요청하면 iOS가 팝업을 그냥 씹고 status 를 notDetermined 로 돌려준다.
 * 그래서 AppState 가 'active' 가 된 뒤 한 박자 쉬고 부른다.
 *
 * 안드로이드·웹에서는 아무 일도 하지 않는다(항상 즉시 resolve).
 */
import { AppState, Platform } from 'react-native';

// active 가 된 뒤 팝업까지의 여유. 0으로 두면 화면 전환 애니메이션과 겹쳐
// 팝업이 안 뜨는 기기가 있다.
const PROMPT_DELAY_MS = 700;

type TrackingModule = typeof import('expo-tracking-transparency');

let mod: TrackingModule | null | undefined;

function getModule(): TrackingModule | null {
  if (mod === undefined) {
    try {
      // 정적 import 는 이 네이티브 모듈이 없는 바이너리(구버전 빌드)에서
      // 앱 시작 자체를 죽인다 — admob.ts 와 같은 이유로 require 를 감싼다.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('expo-tracking-transparency') as TrackingModule;
    } catch {
      mod = null;
    }
  }
  return mod;
}

/** AppState 가 active 가 될 때까지 기다린다(이미 active 면 즉시). */
function whenActive(): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve) => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        sub.remove();
        resolve();
      }
    });
  });
}

let pending: Promise<boolean> | null = null;

/**
 * ATT 동의를 (필요하면) 요청하고, 추적이 허용됐는지 돌려준다.
 *
 * 여러 번 불러도 실제 요청은 한 번만 나간다 — iOS 는 두 번째부터 팝업 없이
 * 기존 상태를 그대로 돌려주지만, 광고를 열 때마다 네이티브를 왕복할 이유가 없다.
 * 실패·모듈 없음·안드로이드는 전부 false 로 조용히 끝난다(광고는 비개인화로 나간다).
 */
export function ensureTrackingPermission(): Promise<boolean> {
  if (Platform.OS !== 'ios') return Promise.resolve(false);
  if (pending) return pending;
  const m = getModule();
  if (!m) return Promise.resolve(false);

  pending = whenActive()
    .then(() => new Promise<void>((r) => setTimeout(r, PROMPT_DELAY_MS)))
    .then(() => m.getTrackingPermissionsAsync())
    .then((current) => {
      // 이미 답을 받은 상태면 다시 묻지 않는다(iOS 가 팝업을 안 띄운다).
      if (current.status !== 'undetermined') return current;
      return m.requestTrackingPermissionsAsync();
    })
    .then((res) => res.status === 'granted')
    .catch(() => false);

  return pending;
}
