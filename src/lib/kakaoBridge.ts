import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * shoppinglog.store 는 Capacitor 네이티브 셸을 전제로 만들어졌고,
 * `window.Capacitor.Plugins.KakaoAuth.login()` 을 직접 호출한다
 * (static/auth.js). 웹페이지는 수정하지 않고, 이 웹뷰 쪽에서 같은
 * 모양의 전역 객체를 주입해 그대로 동작하게 만든다.
 *
 * 흐름: 웹의 KakaoAuth.login() 호출 → postMessage 로 RN에 요청 →
 * RN이 네이티브 카카오 SDK 로그인 실행 → 결과를 injectJavaScript 로
 * 웹의 대기 중인 Promise에 되돌려준다.
 */
export const KAKAO_BRIDGE_MESSAGE_TYPE = 'KAKAO_LOGIN_REQUEST';

// ── 카카오 앱투앱 도중 프로세스 사망 복구 표식 ──────────────────────────
// 카톡이 전면에 있는 동안 안드로이드(특히 삼성)가 우리 프로세스를 죽이면
// SDK 콜백이 유실돼 로그인이 미완으로 끝난다. 카카오 SDK는 성공한 토큰을
// 네이티브에 영속 저장하므로(TokenManagerProvider), 시작 전에 표식을 남기고
// 콜드 스타트에서 표식+저장 토큰이 있으면 세션을 마저 완결한다.
// (authGate.ts 의 웹 OAuth 표식과 동일한 패턴 — 10분 유효, 1회용)
const KAKAO_PENDING_KEY = 'sl_kakao_native_pending_at';
const KAKAO_PENDING_VALID_MS = 10 * 60 * 1000;

export async function markKakaoLoginPending(): Promise<void> {
  try {
    await AsyncStorage.setItem(KAKAO_PENDING_KEY, String(Date.now()));
  } catch {
    // 저장 실패 시 콜드 스타트 복구만 안 될 뿐 로그인 자체는 진행된다.
  }
}

export async function consumeKakaoLoginPending(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KAKAO_PENDING_KEY);
    if (raw == null) return false;
    await AsyncStorage.removeItem(KAKAO_PENDING_KEY);
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < KAKAO_PENDING_VALID_MS;
  } catch {
    return false;
  }
}

export const KAKAO_BRIDGE_INJECTED_JS = `
(function () {
  if (window.Capacitor) return;
  var pending = {};
  var reqId = 0;
  window.Capacitor = {
    isNativePlatform: function () { return true; },
    Plugins: {
      KakaoAuth: {
        login: function () {
          return new Promise(function (resolve, reject) {
            var id = String(++reqId);
            pending[id] = { resolve: resolve, reject: reject };
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: ${JSON.stringify(KAKAO_BRIDGE_MESSAGE_TYPE)},
              id: id,
            }));
          });
        }
      }
    }
  };
  window.__slResolveKakaoLogin = function (id, accessToken) {
    var p = pending[id];
    if (!p) return false;   // 대기 프로미스 유실(웹뷰 리로드) → 호출측이 폴백 처리
    delete pending[id];
    p.resolve({ accessToken: accessToken });
    return true;
  };
  window.__slRejectKakaoLogin = function (id, message) {
    var p = pending[id];
    if (!p) return;
    delete pending[id];
    p.reject(new Error(message));
  };
})();
true;
`;

// 웹뷰에 주입해 카카오 access_token으로 서버 세션을 직접 완결하는 스크립트.
// (동의는 게이트 통과 후에만 kakaoLogin 이 실행되므로 agreed=true. marketing 은
//  이 경로에선 기본 false — 유저가 이후 설정에서 켤 수 있음.)
export function kakaoSessionCompleteScript(accessToken: string): string {
  return `(function(){
    fetch('/api/auth/kakao/token', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: ${JSON.stringify(accessToken)}, agreed: true, marketing: false })
    }).then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){ if (d && d.token) { try { localStorage.setItem('sl_token', d.token); } catch(e){} location.href='/'; } })
      .catch(function(){});
  })(); true;`;
}

export function resolveKakaoLoginScript(id: string, accessToken: string): string {
  // 1) 웹뷰가 살아있고 대기 프로미스가 있으면 기존 웹 흐름(동의 marketing 포함 fetch)이 처리.
  // 2) 삼성 등에서 카톡 왕복 중 웹뷰가 리로드돼 대기 프로미스가 유실되면(__slResolveKakaoLogin
  //    이 false 반환) 직접 세션을 완결한다(kakaoSessionCompleteScript와 동일 로직).
  const t = JSON.stringify(accessToken);
  return `(function(){
    var t=${t};
    try {
      if (window.__slResolveKakaoLogin && window.__slResolveKakaoLogin(${JSON.stringify(id)}, t)) return;
    } catch (e) {}
    fetch('/api/auth/kakao/token', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: t, agreed: true, marketing: false })
    }).then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){ if (d && d.token) { try { localStorage.setItem('sl_token', d.token); } catch(e){} location.href='/'; } })
      .catch(function(){});
  })(); true;`;
}

export function rejectKakaoLoginScript(id: string, message: string): string {
  return `window.__slRejectKakaoLogin(${JSON.stringify(id)}, ${JSON.stringify(message)}); true;`;
}
