import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import type { WebView } from 'react-native-webview';
import { beginOAuth, cancelOAuth, exchangeOAuthCode } from '@/lib/authGate';
import { APP_ORIGIN, isAppOrigin } from '@/lib/externalLinks';

const HOME_URL = APP_ORIGIN;
const APP_AUTH_REDIRECT_PREFIX = 'webview://auth';

// Keep OAuth state and deferred token injection together. The screen owns load state.
export function useWebViewAuth(
  webViewRef: RefObject<WebView | null>,
  isLoaded: RefObject<boolean>,
  currentUrl: RefObject<string>,
) {
  // 로그인 토큰을 웹뷰의 localStorage에 심고 홈으로 보낸다.
  // (Kakao 웹 폴백 로그인이 성공 시 하는 것과 동일한 방식 — auth.js 참고)
  // 웹뷰가 아직 첫 로드를 마치지 않았으면(딥링크 콜드 스타트) 보관해뒀다가
  // onLoadEnd 에서 주입한다. 같은 토큰이 두 경로(인증 세션 + 라우터 파라미터)로
  // 겹쳐 들어와도 한 번만 주입한다.
  // ⚠️ 토큰은 "지금 웹뷰가 떠 있는 오리진"의 localStorage 에 들어간다. 결제·소셜
  // 로그인 때문에 타사 도메인(TRUSTED_HOSTS)에 머물러 있는 채로 주입하면 로그인
  // 토큰을 그 도메인에 넘겨주는 셈이 된다. 자사 오리진일 때만 쓰고, 아니면 홈으로
  // 돌려보낸 뒤 onLoadEnd 에서 다시 시도한다.
  const pendingAuthToken = useRef<string | null>(null);
  const lastAppliedToken = useRef<string | null>(null);
  const authHomeRedirectDone = useRef(false);
  const applyAuthToken = useCallback((token: string) => {
    if (lastAppliedToken.current === token) return;
    if (!isLoaded.current || !isAppOrigin(currentUrl.current)) {
      pendingAuthToken.current = token;
      if (isLoaded.current && !authHomeRedirectDone.current) {
        authHomeRedirectDone.current = true;
        webViewRef.current?.injectJavaScript(
          `window.location.href = ${JSON.stringify(HOME_URL + '/')}; true;`,
        );
      }
      return;
    }
    lastAppliedToken.current = token;
    authHomeRedirectDone.current = false;
    // 주입 시점에도 오리진을 한 번 더 본다(주입과 페이지 이동 사이의 경합 방어).
    webViewRef.current?.injectJavaScript(
      `(function(){if(location.origin!==${JSON.stringify(APP_ORIGIN)})return;` +
        `try{localStorage.setItem('sl_token',${JSON.stringify(token)});}catch(e){}` +
        `location.href='/';})();true;`,
    );
  }, [webViewRef, isLoaded, currentUrl]);

  const completeAppAuthRedirect = useCallback(async (deepLinkUrl: string) => {
    const url = new URL(deepLinkUrl);
    if (url.protocol !== 'webview:' || url.hostname !== 'auth' || (url.pathname && url.pathname !== '/')) return;
    const token = await exchangeOAuthCode(url.searchParams.get('code') || '', url.searchParams.get('state') || '');
    if (token) applyAuthToken(token);
  }, [applyAuthToken]);

  // A process restart may route the callback here instead of the auth-session promise.
  // Both paths use the same serialized, one-time PKCE exchange. Raw tokens are rejected.
  const { code: authCode, state: authState } = useLocalSearchParams<{ code?: string; state?: string }>();
  const handledCode = useRef<string | null>(null);
  useEffect(() => {
    if (typeof authCode !== 'string' || typeof authState !== 'string' || handledCode.current === authCode) return;
    handledCode.current = authCode;
    exchangeOAuthCode(authCode, authState).then((token) => {
      if (token) applyAuthToken(token);
    }).catch(() => Alert.alert('로그인 실패', '로그인을 다시 시작해 주세요.'));
  }, [authCode, authState, applyAuthToken]);

  const oauthInFlight = useRef(false);
  const openNativeOAuth = useCallback((url: string) => {
    if (oauthInFlight.current) return;
    oauthInFlight.current = true;
    void (async () => {
      let state: string | undefined;
      try {
        const login = await beginOAuth(url);
        state = login.state;
        const result = await WebBrowser.openAuthSessionAsync(login.url, APP_AUTH_REDIRECT_PREFIX);
        if (result.type === 'success') await completeAppAuthRedirect(result.url);
      } catch {
        Alert.alert('로그인 실패', '로그인을 다시 시작해 주세요.');
      } finally {
        if (state) await cancelOAuth(state).catch(() => {});
        oauthInFlight.current = false;
      }
    })();
  }, [completeAppAuthRedirect]);

  const flushPendingAuth = useCallback(() => {
    if (!pendingAuthToken.current) return;
    const token = pendingAuthToken.current;
    pendingAuthToken.current = null;
    applyAuthToken(token);
  }, [applyAuthToken]);

  return { openNativeOAuth, flushPendingAuth };
}
