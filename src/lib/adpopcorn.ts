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
import { NativeModules, Platform } from 'react-native';

type AdPopcornRewardModule = typeof import('react-native-adpopcorn-reward');

let mod: AdPopcornRewardModule | null | undefined;

function getModule(): AdPopcornRewardModule | null {
  if (mod === undefined) {
    // require 실패만으로는 부족하다. 이 패키지는 최상위에서
    // `const {RNAdPopcornRewardModule} = NativeModules` 만 하고 null 체크를
    // 하지 않는데, 안드로이드의 NativeEventEmitter 는 null 인자를 허용하므로
    // 네이티브 모듈이 없어도 require 는 조용히 성공한다. 그 상태로 두면
    // 나중에 setUserId 호출에서 TypeError 로 터진다(오퍼월은 안 열리고).
    // 그래서 네이티브 등록 여부를 직접 확인한다.
    if (!NativeModules.RNAdPopcornRewardModule) {
      if (__DEV__) {
        console.warn(
          '[adpopcorn] 네이티브 모듈(RNAdPopcornRewardModule)이 없습니다. ' +
            '이 바이너리에는 SDK가 포함되지 않았습니다 — 새로 빌드해야 합니다.',
        );
      }
      mod = null;
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        mod = require('react-native-adpopcorn-reward') as AdPopcornRewardModule;
      } catch (e) {
        if (__DEV__) console.warn('[adpopcorn] 모듈 로드 실패:', e);
        mod = null;
      }
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
 * 유저식별값을 설정하고 오퍼월을 연다.
 *
 * 실패해도 앱은 죽지 않지만, 예전엔 어디서 막혔는지 알 방법이 전혀 없었다
 * ("눌러도 아무 일도 안 일어남"). 어느 단계에서 멈췄는지 로그로 남긴다.
 *
 * @returns 네이티브 호출까지 도달했으면 true (오퍼월 UI가 실제로 떴는지는
 *          네이티브 SDK 소관이라 여기서 알 수 없다 — 앱키 미설정/액티비티
 *          없음이면 SDK 가 조용히 무시한다)
 */
export function openOfferwall(userId: string): boolean {
  const m = getModule();
  if (!m) return false;
  if (!userId) {
    if (__DEV__) {
      console.warn('[adpopcorn] userId 가 비어 오퍼월을 열지 않습니다. 웹의 메시지 페이로드 확인 필요.');
    }
    return false;
  }
  ensureAppKey();
  m.default.setUserId(userId);
  m.default.openOfferwall();
  return true;
}
