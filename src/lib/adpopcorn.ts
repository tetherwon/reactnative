/**
 * 애드팝콘 오퍼월 — 웹 충전소의 {type:"adpopcorn:openOfferwall"} 메시지 대응.
 *
 * 리워드 적립 자체는 애드팝콘이 백엔드(/api/adpopcorn/postback)로 직접 보내는
 * 서명된 포스트백(HMAC-MD5)이 처리한다. 여기서는 오퍼월 UI를 열고, 닫힘
 * 이벤트가 오면 웹에 알려 잔액을 갱신시킬 뿐이다.
 * (전체 프로토콜: Shopping_log 레포 docs/RN_BRIDGE.md)
 *
 * Android는 매체 키/해시 키를 JS에서 설정할 수 없다 — 네이티브 모듈의
 * setAppKey()/setLogEnable() 이 no-op이다(RNAdPopcornRewardModule.java 확인:
 * "android is not supported. use AndroidManifest.xml"). 그래서 Android는
 * app.config.js의 withAdpopcorn 플러그인이 AndroidManifest.xml meta-data로
 * 주입하고, 여기서는 iOS에서만 setAppKey를 호출한다.
 *
 * admob.ts와 동일하게, 모듈이 없는 바이너리(구버전 앱)에서 import 시점에
 * 죽지 않도록 require를 try/catch로 감싼다.
 */
import { Platform } from 'react-native';

import { ensureTrackingPermissionAsync } from './tracking';

type AdPopcornRewardModule = typeof import('react-native-adpopcorn-reward');

let mod: AdPopcornRewardModule | null | undefined;

function getModule(): AdPopcornRewardModule | null {
  if (mod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('react-native-adpopcorn-reward') as AdPopcornRewardModule;
    } catch {
      mod = null;
    }
  }
  return mod;
}

let appKeySet = false;

// app.config.js와 동일한 EXPO_PUBLIC_ 변수 — Metro가 빌드 시 이 값을 그대로
// JS 번들에 인라인한다(런타임에 process.env를 실제로 조회하는 게 아니다).
const APP_KEY = process.env.EXPO_PUBLIC_ADPOPCORN_APP_KEY || '';
const HASH_KEY = process.env.EXPO_PUBLIC_ADPOPCORN_HASH_KEY || '';

/**
 * 앱키/해시키 설정 (iOS 전용, 최초 1회). Android는 매니페스트로 주입되므로
 * 여기서 호출해도 no-op(안전)이지만, 굳이 두 번 설정할 이유가 없어 건너뛴다.
 */
function ensureAppKey() {
  if (appKeySet || Platform.OS !== 'ios') return;
  const m = getModule();
  if (!m || !APP_KEY || !HASH_KEY) return;
  appKeySet = true;
  m.default.setAppKey(APP_KEY, HASH_KEY);
}

let listenersReady = false;

/**
 * 오퍼월 닫힘 이벤트를 구독한다. 앱 시작 시 1회만 등록하면 된다.
 */
export function ensureAdpopcornListeners(onClosed: () => void) {
  const m = getModule();
  if (!m || listenersReady) return;
  listenersReady = true;
  m.default.addListener(m.AdPopcornRewardEvents.OnClosedOfferWallPage, onClosed);
}

/**
 * 유저식별값을 설정하고 오퍼월을 연다. 모듈이 없으면(구버전 바이너리) 조용히 무시.
 */
export function openOfferwall(userId: string) {
  const m = getModule();
  if (!m || !userId) return;
  ensureAppKey();
  // 오퍼월 참여 추적(IDFA)을 위해 ATT 권한을 먼저 요청한다(iOS, 최초 1회).
  // 거부해도 오퍼월은 열린다 — 매체사 추적 정확도만 떨어진다.
  ensureTrackingPermissionAsync().finally(() => {
    m.default.setUserId(userId);
    m.default.openOfferwall();
  });
}
