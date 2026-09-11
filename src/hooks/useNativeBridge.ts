import { useCallback, useEffect, type RefObject } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview/lib/WebViewTypes';
import { showRewardedAd } from '@/lib/admob';
import { ensureAdpopcornListeners, openOfferwall as openAdpopcornOfferwall } from '@/lib/adpopcorn';
import { APP_ORIGIN, isAppOrigin } from '@/lib/externalLinks';
import * as haptics from '@/lib/haptics';
import { loginWithKakao } from '@/lib/kakaoLogin';
import { KAKAO_BRIDGE_MESSAGE_TYPE, rejectKakaoLoginScript, resolveKakaoLoginScript } from '@/lib/kakaoBridge';
import { getNativePushTokenAsync, ensureNotificationPermission } from '@/lib/notifications';

// 웹은 회원 PK를 숫자로 보낼 수 있다(JSON.stringify({userId: 123})).
// 문자열만 받으면 조용히 빈 값이 돼 광고·오퍼월이 "눌러도 무반응"이 된다.
function toIdString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

export function useNativeBridge(webViewRef: RefObject<WebView | null>, goTo: (url: string) => void) {
  // window.SLNative.* 는 자사 웹이 정의한 함수다. 결제/로그인 때문에 타사
  // 도메인이 떠 있는 동안 그대로 주입하면 FCM 토큰 같은 값을 그쪽 페이지에
  // 넘겨주게 되므로, RN → 웹 방향 호출은 전부 이 오리진 가드를 통과시킨다.
  const injectIntoApp = useCallback((js: string) => {
    webViewRef.current?.injectJavaScript(
      `(function(){if(location.origin!==${JSON.stringify(APP_ORIGIN)})return;${js}})();true;`,
    );
  }, [webViewRef]);

  useEffect(() => {
    void ensureNotificationPermission();
  }, []);

  // 오퍼월이 닫히면 웹에 알려 잔액을 갱신시킨다. 리스너는 앱 생애주기 동안 1회만 등록.
  // (RN → 웹 방향 계약: Shopping_log 레포 docs/RN_BRIDGE.md)
  useEffect(() => {
    ensureAdpopcornListeners(() => {
      injectIntoApp('window.SLNative&&window.SLNative.onAdpopcornClosed();');
    });
  }, [injectIntoApp]);

  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const url = lastResponse?.notification.request.content.data?.url;
    if (typeof url === 'string' && url.length > 0) {
      haptics.success();
      goTo(url);
    }
  }, [lastResponse, goTo]);

  // 웹(native-push.js)에 플랫폼별 FCM/Expo 토큰을 넘겨 로그인 사용자로 등록한다.
  // (RN → 웹 방향 계약: Shopping_log 레포 docs/RN_BRIDGE.md)
  const sendPushTokenToWeb = useCallback(async () => {
    const registration = await getNativePushTokenAsync();
    if (!registration) return;
    injectIntoApp(
      `window.SLNative&&window.SLNative.registerPushToken(` +
        `${JSON.stringify(registration.token)},${JSON.stringify(registration.platform)},${JSON.stringify(registration.provider)});`,
    );
  }, [injectIntoApp]);

  // 기기 토큰 갱신 및 설정 앱에서 알림 권한을 바꾼 뒤 복귀 시 재등록한다.
  useEffect(() => {
    const sub = Notifications.addPushTokenListener(() => {
      sendPushTokenToWeb();
    });
    const activeSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sendPushTokenToWeb();
    });
    return () => { sub.remove(); activeSub.remove(); };
  }, [sendPushTokenToWeb]);

  // 웹 → RN 메시지 라우팅 (window.ReactNativeWebView.postMessage):
  // - KAKAO_LOGIN_REQUEST: 네이티브 카카오 SDK 로그인 → 웹의 Promise로 응답
  // - push:getToken: FCM 토큰 발급 → SLNative.registerPushToken 으로 응답
  // - admob:showRewarded: 보상형 광고 표시 → SLNative.onAdmobResult 로 응답
  // - adpopcorn:openOfferwall: 오퍼월 열기 → 닫히면 SLNative.onAdpopcornClosed 호출
  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      // ⚠️ 브리지는 자사 오리진 전용. 웹뷰에는 결제/로그인 때문에 타사 도메인도
      // 뜨는데(TRUSTED_HOSTS 에는 sites.google.com·blog.naver.com 처럼 남이 JS를
      // 올릴 수 있는 호스트까지 딸려 온다) 그런 페이지가 이 브리지를 쓰면
      // 카카오 accessToken·FCM 토큰을 가져가거나, 자기 adUnit/userId 로 광고·
      // 오퍼월 보상을 자기 앞으로 돌릴 수 있다. 오리진이 다르면 전부 무시한다.
      if (!isAppOrigin(event.nativeEvent.url)) return;

      let data: { type?: string; id?: string; adUnit?: unknown; userId?: unknown };
      try {
        data = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }

      if (data.type === 'push:getToken') {
        sendPushTokenToWeb();
        return;
      }

      if (data.type === 'admob:showRewarded') {
        const adUnit = typeof data.adUnit === 'string' ? data.adUnit : '';
        const userId = toIdString(data.userId);
        showRewardedAd(adUnit, userId).then((rewarded) => {
          injectIntoApp(`window.SLNative&&window.SLNative.onAdmobResult(${rewarded});`);
        });
        return;
      }

      if (data.type === 'adpopcorn:openOfferwall') {
        const opened = openAdpopcornOfferwall(toIdString(data.userId));
        // 오퍼월을 못 열었으면 웹이 대기 상태에 갇히지 않도록 닫힘 콜백을
        // 바로 돌려준다(잔액 갱신 로직을 그대로 태워 UI가 원상복구된다).
        if (!opened) {
          injectIntoApp('window.SLNative&&window.SLNative.onAdpopcornClosed();');
        }
        return;
      }

      if (data.type !== KAKAO_BRIDGE_MESSAGE_TYPE || !data.id) return;
      const { id } = data;

      loginWithKakao()
        .then((accessToken) => {
          webViewRef.current?.injectJavaScript(
            resolveKakaoLoginScript(id, accessToken),
          );
        })
        .catch((error: { code?: string; message?: string }) => {
          const message =
            error?.code === 'E_CANCELLED_OPERATION'
              ? 'cancelled'
              : error?.message || 'login_failed';
          webViewRef.current?.injectJavaScript(rejectKakaoLoginScript(id, message));
        });
    },
    [injectIntoApp, sendPushTokenToWeb, webViewRef],
  );

  return { onMessage };
}
