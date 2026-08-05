/**
 * shoppinglog.store 는 Capacitor 네이티브 셸을 전제로 만들어졌고,
 * `window.Capacitor.Plugins.KakaoAuth.login()` 을 직접 호출한다
 * (static/auth.js). 웹페이지는 수정하지 않고, 이 웹뷰 쪽에서 같은
 * 모양의 전역 객체를 주입해 그대로 동작하게 만든다.
 *
 * 흐름: 웹의 KakaoAuth.login() 호출 → postMessage 로 RN에 요청 →
 * RN이 네이티브 카카오 SDK 로그인 실행 → 결과를 injectJavaScript 로
 * 웹의 대기 중인 Promise에 되돌려준다.
 *
 * ⚠️ 이 브리지는 자사 오리진에서만 살아 있어야 한다. 웹뷰에는 결제/로그인 때문에
 * 타사 도메인(TRUSTED_HOSTS)도 뜨는데, 그 페이지가 브리지를 잡으면 네이티브
 * 카카오 로그인을 시켜 accessToken 을 가져갈 수 있다. 그래서 주입 스크립트와
 * 응답 스크립트 양쪽에 오리진 가드를 둔다(RN 쪽 onMessage 게이트와 이중 방어).
 */
import { APP_ORIGIN } from './externalLinks';

export const KAKAO_BRIDGE_MESSAGE_TYPE = 'KAKAO_LOGIN_REQUEST';

const ORIGIN_GUARD = `if (location.origin !== ${JSON.stringify(APP_ORIGIN)}) return;`;

export const KAKAO_BRIDGE_INJECTED_JS = `
(function () {
  ${ORIGIN_GUARD}
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
    if (!p) return;
    delete pending[id];
    p.resolve({ accessToken: accessToken });
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

// 요청을 보낸 뒤 응답이 오기 전에 페이지가 타사 도메인으로 넘어갔을 수 있다.
// 그 페이지에 그대로 주입하면 accessToken 을 넘겨주게 되므로 여기서도 오리진을 본다.
export function resolveKakaoLoginScript(id: string, accessToken: string): string {
  return `(function(){${ORIGIN_GUARD}window.__slResolveKakaoLogin&&window.__slResolveKakaoLogin(${JSON.stringify(id)}, ${JSON.stringify(accessToken)});})(); true;`;
}

export function rejectKakaoLoginScript(id: string, message: string): string {
  return `(function(){${ORIGIN_GUARD}window.__slRejectKakaoLogin&&window.__slRejectKakaoLogin(${JSON.stringify(id)}, ${JSON.stringify(message)});})(); true;`;
}
