import { useNetInfo } from '@react-native-community/netinfo';
import { getAccessToken as kakaoGetAccessToken, login as kakaoLogin } from '@react-native-seoul/kakao-login';
import * as Notifications from 'expo-notifications';
import { router, useLocalSearchParams, usePathname, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Image,
  Platform,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewMessageEvent,
  WebViewOpenWindowEvent,
} from 'react-native-webview/lib/WebViewTypes';

import ConnectionErrorView from '@/components/ConnectionErrorView';
import { showRewardedAd } from '@/lib/admob';
import { ensureAdpopcornListeners, openOfferwall as openAdpopcornOfferwall } from '@/lib/adpopcorn';
import { consumeOAuthPending, markOAuthPending } from '@/lib/authGate';
import {
  isNativeOAuthStartUrl,
  isOAuthWebStartUrl,
  isTrustedHost,
  isWebViewNavigable,
  openExternalUrl,
} from '@/lib/externalLinks';
import {
  BASE_URL,
  clearToken,
  getToken,
  getTokenSync,
  isNativeScreenEnabled,
  loadAppConfig,
  setToken,
} from '@/lib/api';
import * as haptics from '@/lib/haptics';
import { consumeWebCommand, consumeWebStateDirty, setWebNavListener } from '@/lib/webNav';
import {
  KAKAO_BRIDGE_INJECTED_JS,
  KAKAO_BRIDGE_MESSAGE_TYPE,
  consumeKakaoLoginPending,
  kakaoSessionCompleteScript,
  markKakaoLoginPending,
  rejectKakaoLoginScript,
  resolveKakaoLoginScript,
} from '@/lib/kakaoBridge';
import {
  getFcmDeviceTokenAsync,
  registerForPushNotificationsAsync,
} from '@/lib/notifications';

const HOME_URL = 'https://shoppinglog.store';

// 구글 로그인 완료 후 백엔드(app/routes/auth.py 의 APP_AUTH_REDIRECT)가
// 돌려보내는 딥링크 스킴. app.config.js 의 scheme("webview")과 일치해야
// 하고, 백엔드 환경변수 APP_AUTH_REDIRECT 도 이 값으로 맞춰야 한다
// (기본값 "shoppinglog://auth" 는 이 앱 스킴과 다르므로 반드시 덮어써야 함).
const APP_AUTH_REDIRECT_PREFIX = 'webview://auth';

// 웹뷰 로딩 화면을 네이티브 스플래시(파란 배경 + 곰돌이)와 이어지게 하기 위해
// 같은 아이콘을 쓴다. icon.png 배경색(#1371F9)이 로딩 배경과 같아 이음새 없음.
const LOADING_BEAR = require('../../assets/images/icon.png');

// 네이티브로 전환 가능한 화면: 웹 경로 → app-config native_screens 의 화면 키.
// 서버 목록에 키가 있을 때만 웹뷰 이동을 가로채 네이티브로 연다.
// needsAuth 화면은 인증 토큰(핸드오프 완료)까지 있어야 가로챈다 — 게스트는 웹 흐름 유지.
const NATIVE_SCREEN_PATHS: { path: string; screen: string; needsAuth: boolean }[] = [
  { path: '/benefit', screen: 'benefit', needsAuth: true },
  { path: '/roulette', screen: 'roulette', needsAuth: true },
  { path: '/discount-log', screen: 'discount-log', needsAuth: false },
  { path: '/cs', screen: 'cs', needsAuth: false },
  { path: '/my-purchases', screen: 'my-purchases', needsAuth: true },
  { path: '/point-draw', screen: 'point-draw', needsAuth: true },
  { path: '/profile', screen: 'profile', needsAuth: true },
  { path: '/charge', screen: 'charge', needsAuth: true },
  { path: '/tickets', screen: 'tickets', needsAuth: true },
  { path: '/kospi', screen: 'kospi', needsAuth: true },
  { path: '/coupons', screen: 'coupons', needsAuth: true },
  { path: '/invite', screen: 'invite', needsAuth: true },
  { path: '/roulette-history', screen: 'roulette-history', needsAuth: true },
  { path: '/store', screen: 'store', needsAuth: false },
  { path: '/tournament', screen: 'tournament', needsAuth: false },
];

function matchNativeScreenPath(url: string, hasToken: boolean): string | null {
  const m = url.match(/^https:\/\/shoppinglog\.store(\/[a-z-]+)\/?$/i);
  if (!m) return null;
  const found = NATIVE_SCREEN_PATHS.find((s) => s.path === m[1]);
  if (!found || !isNativeScreenEnabled(found.screen)) return null;
  if (found.needsAuth && !hasToken) return null;
  return found.path;
}

// 웹(spa-nav.js)이 SPA 전환 대신 최상위 이동을 하도록 네이티브 경로를 알려준다
// (최상위 이동이어야 onShouldStartLoadWithRequest 가 가로챌 수 있다).
function nativePathsScript(): string {
  const paths = NATIVE_SCREEN_PATHS.filter((s) => isNativeScreenEnabled(s.screen)).map(
    (s) => s.path,
  );
  return `window.__slNativePaths=${JSON.stringify(paths)};true;`;
}


export default function HomeScreen() {
  const webViewRef = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const isLoaded = useRef(false);
  const pendingUrl = useRef<string | null>(null);
  const lastBackPress = useRef(0);
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // native_screens 설정이 로드/갱신될 때마다 bump — injectedJavaScriptBeforeContentLoaded
  // (콘텐츠 로드 전 __slNativePaths 주입)를 재계산해 다음 내비게이션에 반영한다.
  const [configVersion, setConfigVersion] = useState(0);

  const { isConnected } = useNetInfo();
  const isOffline = isConnected === false;

  const goTo = useCallback((url: string) => {
    if (isLoaded.current) {
      webViewRef.current?.injectJavaScript(
        `window.location.href = ${JSON.stringify(url)}; true;`,
      );
    } else {
      pendingUrl.current = url;
    }
  }, []);

  const handleRetry = useCallback(() => {
    setLoadError(false);
    setFirstLoadDone(false);
    webViewRef.current?.reload();
  }, []);

  useEffect(() => {
    registerForPushNotificationsAsync();
  }, []);

  // 네이티브 화면(혜택·룰렛)이 스택 위에 떠 있는 동안엔 이 화면(웹뷰)의
  // 하드웨어 뒤로가기·딥링크 핸들러가 개입하면 안 된다.
  const pathname = usePathname();
  const isWebViewFocused = useRef(true);
  useEffect(() => {
    isWebViewFocused.current = pathname === '/';
    if (pathname === '/' && isLoaded.current) {
      // 네이티브 로그아웃: 웹뷰 쿠키 세션·로컬 캐시까지 정리해 로그인 상태를 일치시킨다
      if (consumeWebCommand() === 'logout') {
        webViewRef.current?.injectJavaScript(
          "fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'," +
            "headers:{'X-Requested-With':'XMLHttpRequest'}}).catch(function(){}).finally(function(){" +
            "try{localStorage.removeItem('sl_token');window.SLUtils&&window.SLUtils.clearMeCache&&window.SLUtils.clearMeCache();}catch(e){}" +
            "location.href='/';});true;",
        );
        return;
      }
      // 네이티브 화면에서 잔액 변동(룰렛 스핀·출석) 후 복귀: 웹 캐시를 지우고
      // 새로고침해 상단 캐시·티켓 표시를 서버 값과 맞춘다 (SW 캐시라 리로드는 즉시).
      if (consumeWebStateDirty()) {
        webViewRef.current?.injectJavaScript(
          'try{window.SLUtils&&window.SLUtils.clearMeCache&&window.SLUtils.clearMeCache();}catch(e){}' +
            'location.reload();true;',
        );
      }
    }
  }, [pathname]);

  // 하이브리드 부팅: 토큰 동기 캐시 예열 + 원격 native_screens 로드(캐시 즉시, 네트워크 갱신)
  useEffect(() => {
    getToken();
    loadAppConfig().then(() => setConfigVersion((v) => v + 1));
    // 앱이 포그라운드로 돌아올 때마다 native_screens 재로드 — 관리자가 킬스위치로
    // 화면을 끄면, 앱을 껐다 켜지 않아도(백그라운드→복귀) 다음 진입부터 웹뷰로 롤백된다.
    // (부팅 1회만 로드하면 이미 켜둔 유저에게 롤백이 재시작 전까지 도달 못 하는 문제)
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') loadAppConfig().then(() => setConfigVersion((v) => v + 1));
    });
    return () => sub.remove();
  }, []);

  // __slNativePaths 를 콘텐츠 로드 '전'에 주입 — onLoadEnd(로드 완료 후)에만 주입하면
  // 로드 완료 전 탭 클릭 시 spa-nav가 값을 못 보고 SPA 스왑으로 새어 웹 버전이 뜨는
  // 레이스가 있다. 카카오 브릿지와 함께 beforeContentLoaded 로 올려 그 창을 없앤다.
  // configVersion 이 바뀌면(설정 갱신) 재계산되어 다음 내비게이션부터 최신 경로 반영.
  const beforeContentLoadedJS = useMemo(
    () => `${KAKAO_BRIDGE_INJECTED_JS}\n${nativePathsScript()}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configVersion],
  );

  // 네이티브 화면 → 웹뷰 페이지 복귀 (예: 혜택 화면의 '티켓 충전소' → /tickets).
  // router 파라미터를 쓰면 이 화면이 리마운트되어 웹뷰가 처음부터 다시 로드되므로
  // (앱 재시작처럼 보임) 이벤트 버스(webNav)로 목적지만 받는다.
  const lastWebUrl = useRef<string>(HOME_URL);
  useEffect(() => {
    return setWebNavListener((path) => {
      const target = BASE_URL + path;
      // 이미 그 페이지면 불필요한 리로드 생략 (하단 네비 '홈' 연타 등)
      const cur = lastWebUrl.current.replace(/[?#].*$/, '').replace(/\/$/, '');
      if (cur === target.replace(/\/$/, '')) return;
      goTo(target);
    });
  }, [goTo]);

  // 토큰 핸드오프: 웹뷰 쿠키 세션을 Bearer 토큰으로 교환해 네이티브 화면이 쓰게 한다.
  // 로그아웃(401)만 토큰 삭제로 취급하고, 그 외 실패(레이트리밋 등)는 무시한다.
  const lastHandoffAt = useRef(0);
  // force=true: 웹이 계정 변경(로그인/로그아웃)을 알린 경우 — throttle 무시하고 즉시 재핸드오프.
  // (그래야 네이티브 토큰이 이전 계정으로 남아 데이터가 교차되는 P2를 막는다.)
  const requestAuthHandoff = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastHandoffAt.current < 60_000) return;
    lastHandoffAt.current = now;
    webViewRef.current?.injectJavaScript(
      "(function(){try{fetch('/api/auth/app-token',{method:'POST',credentials:'same-origin'," +
        "headers:{'X-Requested-With':'XMLHttpRequest'}}).then(function(r){" +
        'if(r.ok){r.json().then(function(d){if(d&&d.token&&window.ReactNativeWebView)' +
        "window.ReactNativeWebView.postMessage(JSON.stringify({type:'auth:token',token:d.token}))});return;}" +
        'if(r.status===401&&window.ReactNativeWebView)' +
        "window.ReactNativeWebView.postMessage(JSON.stringify({type:'auth:none'}))" +
        '}).catch(function(){})}catch(e){}})();true;',
    );
  }, []);

  // 오퍼월이 닫히면 웹에 알려 잔액을 갱신시킨다. 리스너는 앱 생애주기 동안 1회만 등록.
  // (RN → 웹 방향 계약: Shopping_log 레포 docs/RN_BRIDGE.md)
  useEffect(() => {
    ensureAdpopcornListeners(() => {
      webViewRef.current?.injectJavaScript(
        'window.SLNative&&window.SLNative.onAdpopcornClosed();true;',
      );
    });
  }, []);

  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const url = lastResponse?.notification.request.content.data?.url;
    if (typeof url === 'string' && url.length > 0) {
      haptics.success();
      goTo(url);
    }
  }, [lastResponse, goTo]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // 네이티브 화면이 위에 떠 있으면 기본 동작(스택 pop)에 맡긴다
      if (!isWebViewFocused.current) return false;
      if (canGoBack.current) {
        webViewRef.current?.goBack();
        return true;
      }
      const now = Date.now();
      if (now - lastBackPress.current < 2000) {
        return false;
      }
      lastBackPress.current = now;
      ToastAndroid.show('한 번 더 누르면 종료돼요', ToastAndroid.SHORT);
      return true;
    });
    return () => sub.remove();
  }, []);

  const onNavigationStateChange = (navState: WebViewNavigation) => {
    canGoBack.current = navState.canGoBack;
    if (navState.url) lastWebUrl.current = navState.url;
  };

  // 로그인 토큰을 웹뷰의 localStorage에 심고 홈으로 보낸다.
  // (Kakao 웹 폴백 로그인이 성공 시 하는 것과 동일한 방식 — auth.js 참고)
  // 웹뷰가 아직 첫 로드를 마치지 않았으면(딥링크 콜드 스타트) 보관해뒀다가
  // onLoadEnd 에서 주입한다. 같은 토큰이 두 경로(인증 세션 + 라우터 파라미터)로
  // 겹쳐 들어와도 한 번만 주입한다.
  const pendingAuthToken = useRef<string | null>(null);
  const lastAppliedToken = useRef<string | null>(null);
  const applyAuthToken = useCallback((token: string) => {
    if (lastAppliedToken.current === token) return;
    if (!isLoaded.current) {
      pendingAuthToken.current = token;
      return;
    }
    lastAppliedToken.current = token;
    webViewRef.current?.injectJavaScript(
      `try{localStorage.setItem('sl_token',${JSON.stringify(token)});}catch(e){}` +
        `window.location.href='/';true;`,
    );
  }, []);

  // 로그인 완료 후 백엔드가 webview://auth?token=...&new=... 로 돌려준
  // 딥링크에서 토큰을 꺼낸다. 인증 세션이 직접 돌려준 결과라 출처가 확실하므로
  // 게이트 확인 없이 수용하되, 남은 진행 중 표식은 소모해 재사용을 막는다.
  const completeAppAuthRedirect = useCallback(
    (deepLinkUrl: string) => {
      const match = deepLinkUrl.match(/[?&]token=([^&]+)/);
      if (!match) return;
      consumeOAuthPending();
      applyAuthToken(decodeURIComponent(match[1]));
    },
    [applyAuthToken],
  );

  // 로그인 딥링크가 openAuthSessionAsync 에 잡히지 않고 Expo Router 로 직접
  // 들어온 경우(로그인 도중 앱 프로세스가 죽었다가 딥링크로 재시작된 경우 등).
  // +native-intent.tsx 가 webview://auth?token=... 을 /?token=... 으로
  // 돌려보내므로 여기서 token 파라미터를 받아 처리한다.
  // ⚠️ 이 경로의 딥링크는 아무 앱이나 쏠 수 있으므로, 우리가 로그인을 시작했다는
  // 표식(authGate)이 있을 때만 수용한다 — 없으면 세션 픽세이션 시도로 보고 버린다.
  const { token: authTokenParam } = useLocalSearchParams<{ token?: string }>();
  const handledAuthTokenParam = useRef<string | null>(null);
  useEffect(() => {
    if (typeof authTokenParam !== 'string' || authTokenParam.length === 0) return;
    if (handledAuthTokenParam.current === authTokenParam) return;
    handledAuthTokenParam.current = authTokenParam;
    consumeOAuthPending().then((accepted) => {
      if (accepted) applyAuthToken(authTokenParam);
    });
  }, [authTokenParam, applyAuthToken]);

  // 구글은 임베디드 웹뷰 안에서의 OAuth 로그인을 자체 차단한다
  // (Error 403: disallowed_useragent). /auth/google "시작 경로"로 가는
  // 이동을 통째로 시스템 인증 세션(Custom Tab/SFSafariViewController)
  // 하나로 열어서 자사→구글→자사 콜백을 전부 같은 브라우저 쿠키 저장소
  // 안에서 처리하고, 최종 앱 딥링크(webview://auth)로 돌아오면 웹뷰에
  // 토큰을 넘겨준다.
  const openGoogleOAuth = useCallback(
    (url: string) => {
      // 인증 세션을 열기 전에 "로그인 진행 중" 표식을 남긴다. 프로세스가
      // 죽었다 딥링크로 재시작돼도 라우터 경로가 토큰을 수용할 수 있게.
      markOAuthPending().finally(() => {
        WebBrowser.openAuthSessionAsync(url, APP_AUTH_REDIRECT_PREFIX)
          .then((result) => {
            if (result.type === 'success' && result.url) {
              completeAppAuthRedirect(result.url);
            }
          })
          .catch(() => {});
      });
    },
    [completeAppAuthRedirect],
  );

  // 새 창 요청(target="_blank" 링크, window.open) 처리.
  // 안드로이드는 이 핸들러가 없으면 새 창을 화면에 붙지 않는 보이지 않는
  // 웹뷰에 열어버려서, 눌러도 아무 일도 없는 것처럼 보인다(iOS 는 정상).
  const onOpenWindow = useCallback(
    (event: WebViewOpenWindowEvent) => {
      const { targetUrl } = event.nativeEvent;
      if (isNativeOAuthStartUrl(targetUrl)) {
        openGoogleOAuth(targetUrl);
      } else if (isWebViewNavigable(targetUrl) && isTrustedHost(targetUrl)) {
        goTo(targetUrl);
      } else {
        openExternalUrl(targetUrl);
      }
    },
    [goTo, openGoogleOAuth],
  );

  // 신뢰 도메인(자사·결제·로그인)의 웹 URL만 웹뷰가 처리하고, 그 외 http(s) 최상위
  // 이동(외부 쇼핑몰 등)과 앱 스킴(intent://, tel:, kakaotalk:// 등)은 외부로 넘긴다.
  // (웹뷰가 앱 스킴을 직접 열면 ERR_UNKNOWN_URL_SCHEME 에러 화면이 뜬다.)
  const onShouldStartLoadWithRequest = useCallback(
    (request: ShouldStartLoadRequest) => {
      if (isNativeOAuthStartUrl(request.url)) {
        openGoogleOAuth(request.url);
        return false;
      }
      // 웹뷰 안에서 진행되는 소셜 로그인(애플 등)도 마지막에 딥링크로 끝나므로
      // 표식을 남겨야 라우터 경로가 토큰을 수용한다.
      if (isOAuthWebStartUrl(request.url)) markOAuthPending();
      // 네이티브 전환 화면(app-config native_screens)
      if (request.isTopFrame !== false) {
        const nativePath = matchNativeScreenPath(request.url, !!getTokenSync());
        if (nativePath) {
          haptics.tap();
          router.push(nativePath as Href);
          return false;
        }
      }
      if (!isWebViewNavigable(request.url)) {
        openExternalUrl(request.url);
        return false;
      }
      // 신뢰 도메인(자사·결제·로그인)이 아닌 http(s) "최상위" 이동 — 외부 쇼핑몰 등 —
      // 은 시스템 브라우저로 내보낸다. 쿠팡(link.coupang.com) 같은 앱링크 도메인은
      // 거기서 해당 몰 앱이 바로 뜬다. 웹(shared-utils.js openOutbound)이 제휴 클릭을
      // location.href 최상위 이동으로 넘기는 계약의 수신부가 바로 이 분기다.
      // iframe(isTopFrame === false, iOS 전용 필드)은 페이지 구성요소라 웹뷰가 그대로 처리.
      const isMainFrame = request.isTopFrame !== false;
      if (isMainFrame && /^https?:/i.test(request.url) && !isTrustedHost(request.url)) {
        openExternalUrl(request.url);
        return false;
      }
      return true;
    },
    [openGoogleOAuth],
  );

  // 웹(native-push.js)에 FCM 토큰을 넘겨 서버에 등록시킨다.
  // (RN → 웹 방향 계약: Shopping_log 레포 docs/RN_BRIDGE.md)
  const sendPushTokenToWeb = useCallback(async () => {
    const token = await getFcmDeviceTokenAsync();
    if (!token) return;
    webViewRef.current?.injectJavaScript(
      `window.SLNative&&window.SLNative.registerPushToken(` +
        `${JSON.stringify(token)},${JSON.stringify(Platform.OS)});true;`,
    );
  }, []);

  // FCM 토큰이 갱신되면 웹에 다시 등록시킨다.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = Notifications.addPushTokenListener(() => {
      sendPushTokenToWeb();
    });
    return () => sub.remove();
  }, [sendPushTokenToWeb]);

  // 웹 → RN 메시지 라우팅 (window.ReactNativeWebView.postMessage):
  // - KAKAO_LOGIN_REQUEST: 네이티브 카카오 SDK 로그인 → 웹의 Promise로 응답
  // - push:getToken: FCM 토큰 발급 → SLNative.registerPushToken 으로 응답
  // - admob:showRewarded: 보상형 광고 표시 → SLNative.onAdmobResult 로 응답
  // - adpopcorn:openOfferwall: 오퍼월 열기 → 닫히면 SLNative.onAdpopcornClosed 호출
  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let data: {
        type?: string;
        id?: string;
        adUnit?: unknown;
        userId?: unknown;
        token?: unknown;
      };
      try {
        data = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }

      if (data.type === 'auth:token') {
        if (typeof data.token === 'string' && data.token.length > 0) {
          setToken(data.token);
        }
        return;
      }

      if (data.type === 'auth:none') {
        clearToken();
        return;
      }

      if (data.type === 'auth:refresh') {
        // 웹이 계정 변경(로그인/로그아웃)을 알림 — throttle 무시하고 즉시 재핸드오프.
        // app-token이 새 토큰(로그인) 또는 401→auth:none(로그아웃)으로 응답한다.
        requestAuthHandoff(true);
        return;
      }

      if (data.type === 'push:getToken') {
        sendPushTokenToWeb();
        return;
      }

      if (data.type === 'admob:showRewarded') {
        const adUnit = typeof data.adUnit === 'string' ? data.adUnit : '';
        const userId = typeof data.userId === 'string' ? data.userId : '';
        showRewardedAd(adUnit, userId).then((rewarded) => {
          webViewRef.current?.injectJavaScript(
            `window.SLNative&&window.SLNative.onAdmobResult(${rewarded});true;`,
          );
        });
        return;
      }

      if (data.type === 'adpopcorn:openOfferwall') {
        const userId = typeof data.userId === 'string' ? data.userId : '';
        openAdpopcornOfferwall(userId);
        return;
      }

      if (data.type !== KAKAO_BRIDGE_MESSAGE_TYPE || !data.id) return;
      const { id } = data;

      // 중복 호출 가드: 로그인 진행 중 재클릭/웹뷰 리로드로 요청이 겹치면
      // 네이티브 SDK가 동시 실행돼 크래시할 수 있다. 늦은 요청은 조용히 거절
      // ('cancelled'는 웹이 에러 토스트 없이 무시하는 코드).
      if (kakaoLoginInFlight.current) {
        webViewRef.current?.injectJavaScript(rejectKakaoLoginScript(id, 'cancelled'));
        return;
      }
      kakaoLoginInFlight.current = true;
      // 프로세스 사망 복구 표식: 카톡 왕복 중 앱이 죽으면 이 표식+SDK에 영속
      // 저장된 토큰으로 콜드 스타트에서 로그인을 마저 완결한다(onLoadEnd).
      markKakaoLoginPending();

      kakaoLogin()
        .then((result) => {
          webViewRef.current?.injectJavaScript(
            resolveKakaoLoginScript(id, result.accessToken),
          );
        })
        .catch((error: { code?: string; message?: string }) => {
          const message =
            error?.code === 'E_CANCELLED_OPERATION'
              ? 'cancelled'
              : error?.message || 'login_failed';
          webViewRef.current?.injectJavaScript(rejectKakaoLoginScript(id, message));
        })
        .finally(() => {
          kakaoLoginInFlight.current = false;
          // 콜백이 정상 전달됐으면 콜드 스타트 복구는 불필요 — 표식 소모
          consumeKakaoLoginPending();
        });
    },
    [sendPushTokenToWeb, requestAuthHandoff],
  );

  // onLoadEnd 는 로드 "실패" 시에도 불린다(onError 직후). 실패한 로드에
  // 보관해둔 토큰/URL을 주입하면 에러 페이지에 떨어져 그대로 소실되므로,
  // 성공한 로드에서만 소비하고 실패 시엔 다음 로드까지 보관한다.
  const lastLoadFailed = useRef(false);
  // 카카오 앱투앱 진행 중 가드 + 콜드 스타트 복구 1회 실행 플래그
  const kakaoLoginInFlight = useRef(false);
  const kakaoRecoveryChecked = useRef(false);
  const onLoadEnd = () => {
    setFirstLoadDone(true);
    const failed = lastLoadFailed.current;
    lastLoadFailed.current = false;
    isLoaded.current = true;
    if (failed) return;
    // 네이티브 전환 경로 목록을 웹(spa-nav.js)에 알리고, 인증 토큰 핸드오프를 요청한다
    webViewRef.current?.injectJavaScript(nativePathsScript());
    requestAuthHandoff();
    // 카카오 앱투앱 도중 프로세스가 죽은 경우의 콜드 스타트 복구:
    // 표식(10분 유효)이 남아 있고 SDK에 영속 저장된 토큰이 있으면 세션을 완결한다.
    if (!kakaoRecoveryChecked.current) {
      kakaoRecoveryChecked.current = true;
      consumeKakaoLoginPending().then((pending) => {
        if (!pending || kakaoLoginInFlight.current) return;
        kakaoGetAccessToken()
          .then((t) => {
            const accessToken = (t as { accessToken?: string } | null)?.accessToken;
            if (accessToken) {
              webViewRef.current?.injectJavaScript(kakaoSessionCompleteScript(accessToken));
            }
          })
          .catch(() => {}); // 저장 토큰 없음/만료 — 유저가 다시 로그인하면 됨
      });
    }
    // 토큰을 먼저 심는다 — 아래 pendingUrl 이동이 최종 목적지가 되더라도
    // localStorage 저장은 유지되므로 둘 다 살릴 수 있다.
    if (pendingAuthToken.current) {
      const token = pendingAuthToken.current;
      pendingAuthToken.current = null;
      applyAuthToken(token);
    }
    if (pendingUrl.current) {
      const url = pendingUrl.current;
      pendingUrl.current = null;
      webViewRef.current?.injectJavaScript(
        `window.location.href = ${JSON.stringify(url)}; true;`,
      );
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <WebView
          ref={webViewRef}
          source={{ uri: HOME_URL }}
          style={styles.webview}
          onNavigationStateChange={onNavigationStateChange}
          onOpenWindow={onOpenWindow}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onLoadEnd={onLoadEnd}
          onMessage={onMessage}
          injectedJavaScriptBeforeContentLoaded={beforeContentLoadedJS}
          onError={() => {
            lastLoadFailed.current = true;
            setFirstLoadDone(true);
            setLoadError(true);
            haptics.error();
          }}
          onContentProcessDidTerminate={() => webViewRef.current?.reload()}
          domStorageEnabled
          javaScriptEnabled
          allowsInlineMediaPlayback
        />
      </SafeAreaView>
      {!firstLoadDone && !loadError && (
        <View style={styles.loader} pointerEvents="none">
          <Image source={LOADING_BEAR} style={styles.loadingBear} resizeMode="contain" />
          <Text style={styles.loadingTagline}>쇼핑적립은 쇼핑로그</Text>
        </View>
      )}
      {(loadError || isOffline) && (
        <View style={StyleSheet.absoluteFill}>
          <ConnectionErrorView
            title={isOffline ? '오프라인 상태예요' : '페이지를 불러올 수 없어요'}
            message={
              isOffline
                ? '인터넷에 연결되어 있지 않아요. 연결 후 다시 시도해 주세요.'
                : '잠시 후 다시 시도해 주세요.'
            }
            onRetry={handleRetry}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  webview: {
    flex: 1,
  },
  loader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // 네이티브 스플래시와 동일한 파란 배경 → 스플래시→로딩 전환이 이어짐
    backgroundColor: '#1371F9',
  },
  loadingBear: {
    width: 200,
    height: 200,
  },
  loadingTagline: {
    marginTop: 6,
    color: '#ffffff',
    fontSize: 22,
    fontFamily: 'Pretendard-Black',
    letterSpacing: -0.3,
  },
});
