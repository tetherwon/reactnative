import { useNetInfo } from '@react-native-community/netinfo';
import { login as kakaoLogin } from '@react-native-seoul/kakao-login';
import * as Notifications from 'expo-notifications';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
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
  WebViewProgressEvent,
} from 'react-native-webview/lib/WebViewTypes';

import ConnectionErrorView from '@/components/ConnectionErrorView';
import { showRewardedAd } from '@/lib/admob';
import { ensureAdpopcornListeners, openOfferwall as openAdpopcornOfferwall } from '@/lib/adpopcorn';
import { consumeOAuthPending, markOAuthPending } from '@/lib/authGate';
import {
  APP_ORIGIN,
  isAppOrigin,
  isNativeOAuthStartUrl,
  isOAuthWebStartUrl,
  isTrustedHost,
  isWebViewNavigable,
  openExternalUrl,
  resolveNavigationTarget,
} from '@/lib/externalLinks';
import * as haptics from '@/lib/haptics';
import {
  KAKAO_BRIDGE_INJECTED_JS,
  KAKAO_BRIDGE_MESSAGE_TYPE,
  rejectKakaoLoginScript,
  resolveKakaoLoginScript,
} from '@/lib/kakaoBridge';
import {
  getFcmDeviceTokenAsync,
  registerForPushNotificationsAsync,
} from '@/lib/notifications';

const HOME_URL = APP_ORIGIN;

// 웹은 회원 PK를 숫자로 보낼 수 있다(JSON.stringify({userId: 123})).
// 문자열만 받으면 조용히 빈 값이 돼 광고·오퍼월이 "눌러도 무반응"이 된다.
function toIdString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

// 구글 로그인 완료 후 백엔드(app/routes/auth.py 의 APP_AUTH_REDIRECT)가
// 돌려보내는 딥링크 스킴. app.config.js 의 scheme("webview")과 일치해야
// 하고, 백엔드 환경변수 APP_AUTH_REDIRECT 도 이 값으로 맞춰야 한다
// (기본값 "shoppinglog://auth" 는 이 앱 스킴과 다르므로 반드시 덮어써야 함).
const APP_AUTH_REDIRECT_PREFIX = 'webview://auth';

// 웹뷰 로딩 화면을 네이티브 스플래시(파란 배경 + 곰돌이)와 이어지게 하기 위해
// 같은 아이콘을 쓴다. icon.png 배경색(#1371F9)이 로딩 배경과 같아 이음새 없음.
const LOADING_BEAR = require('../../assets/images/icon.png');

// 이 진행률을 넘기면 첫 화면은 이미 그려져 있다고 보고 로딩 오버레이를 걷는다.
// 너무 낮으면 흰 화면이 비치고, 1.0 이면 onLoadEnd 와 다를 게 없다.
const FIRST_PAINT_PROGRESS = 0.75;


export default function HomeScreen() {
  const webViewRef = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const isLoaded = useRef(false);
  const pendingUrl = useRef<string | null>(null);
  const lastBackPress = useRef(0);
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const { isConnected } = useNetInfo();
  const isOffline = isConnected === false;

  // 앱이 코드로 웹뷰를 이동시키는 유일한 통로(푸시 알림 등). 여기로 들어오는
  // URL 은 앱 밖(푸시 페이로드)에서 오므로 반드시 검증한다 — javascript:/data: 가
  // 통과하면 자사 오리진에서 임의 스크립트가 돌아 sl_token 이 털린다.
  // 신뢰 도메인이 아닌 http(s) 주소는 사용자가 주소창을 볼 수 있게 외부 브라우저로.
  const goTo = useCallback((rawUrl: string) => {
    const url = resolveNavigationTarget(rawUrl);
    if (!url) {
      // 신뢰 도메인이 아닌 http(s) 주소는 사용자가 주소창을 볼 수 있게 외부 브라우저로.
      if (/^https?:/i.test(rawUrl)) openExternalUrl(rawUrl);
      return;
    }
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

  // window.SLNative.* 는 자사 웹이 정의한 함수다. 결제/로그인 때문에 타사
  // 도메인이 떠 있는 동안 그대로 주입하면 FCM 토큰 같은 값을 그쪽 페이지에
  // 넘겨주게 되므로, RN → 웹 방향 호출은 전부 이 오리진 가드를 통과시킨다.
  const injectIntoApp = useCallback((js: string) => {
    webViewRef.current?.injectJavaScript(
      `(function(){if(location.origin!==${JSON.stringify(APP_ORIGIN)})return;${js}})();true;`,
    );
  }, []);

  useEffect(() => {
    registerForPushNotificationsAsync();
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

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
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

  // 현재 웹뷰가 보고 있는 주소. 로그인 토큰을 어느 오리진의 localStorage 에
  // 쓰게 되는지 판단하는 데 쓴다(applyAuthToken 참고).
  const currentUrl = useRef(HOME_URL);

  const onNavigationStateChange = (navState: WebViewNavigation) => {
    canGoBack.current = navState.canGoBack;
    if (navState.url) currentUrl.current = navState.url;
  };

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
    injectIntoApp(
      `window.SLNative&&window.SLNative.registerPushToken(` +
        `${JSON.stringify(token)},${JSON.stringify(Platform.OS)});`,
    );
  }, [injectIntoApp]);

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
        });
    },
    [injectIntoApp, sendPushTokenToWeb],
  );

  // onLoadEnd 는 로드 "실패" 시에도 불린다(onError 직후). 실패한 로드에
  // 보관해둔 토큰/URL을 주입하면 에러 페이지에 떨어져 그대로 소실되므로,
  // 성공한 로드에서만 소비하고 실패 시엔 다음 로드까지 보관한다.
  const lastLoadFailed = useRef(false);

  // 로딩 오버레이(파란 배경 + 곰돌이)를 걷는 시점.
  // onLoadEnd 는 이미지·광고·서드파티 스크립트까지 모든 서브리소스가 끝나야
  // 불리는데, 화면은 그보다 한참 먼저 그려져 있다. 그동안 오버레이가 덮고 있으면
  // 다 그려진 페이지를 못 보고 기다리게 된다. 진행률이 충분히 올라오면 먼저 걷고,
  // onLoadEnd 는 (진행률 이벤트가 안 오는 경우를 위한) 안전망으로 남긴다.
  const onLoadProgress = ({ nativeEvent }: WebViewProgressEvent) => {
    if (nativeEvent.progress >= FIRST_PAINT_PROGRESS) setFirstLoadDone(true);
  };

  const onLoadEnd = () => {
    setFirstLoadDone(true);
    const failed = lastLoadFailed.current;
    lastLoadFailed.current = false;
    isLoaded.current = true;
    if (failed) return;
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
          onLoadProgress={onLoadProgress}
          onLoadEnd={onLoadEnd}
          onMessage={onMessage}
          injectedJavaScriptBeforeContentLoaded={KAKAO_BRIDGE_INJECTED_JS}
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
          // GPU 레이어로 합성해 스크롤 프레임 드랍을 줄인다.
          // cacheMode 는 LOAD_DEFAULT(서버 캐시 헤더를 그대로 따름)를 유지한다 —
          // LOAD_CACHE_ELSE_NETWORK 로 두면 만료된 캐시까지 우선 쓰는 바람에
          // 적립금·포인트 잔액이 옛날 값으로 보일 수 있다. 첫 로드 체감은
          // 위 onLoadProgress 로 줄인다.
          // setSupportMultipleWindows 는 건드리지 않는다 — false 로 두면 위
          // onOpenWindow 가 아예 안 불려서 새 창 링크(target="_blank")가 먹통이 된다.
          cacheEnabled
          cacheMode="LOAD_DEFAULT"
          androidLayerType="hardware"
          overScrollMode="never"
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
