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

export function resolveKakaoLoginScript(id: string, accessToken: string): string {
  return `window.__slResolveKakaoLogin(${JSON.stringify(id)}, ${JSON.stringify(accessToken)}); true;`;
}

export function rejectKakaoLoginScript(id: string, message: string): string {
  return `window.__slRejectKakaoLogin(${JSON.stringify(id)}, ${JSON.stringify(message)}); true;`;
}
