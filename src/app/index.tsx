import { useNetInfo } from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, StyleSheet, ToastAndroid, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewOpenWindowEvent, WebViewProgressEvent } from 'react-native-webview/lib/WebViewTypes';
import ConnectionErrorView from '@/components/ConnectionErrorView';
import WebViewSplash from '@/components/WebViewSplash';
import { useNativeBridge } from '@/hooks/useNativeBridge';
import { useWebViewAuth } from '@/hooks/useWebViewAuth';
import { APP_ORIGIN, isNativeOAuthStartUrl, isTrustedHost, isWebViewNavigable, openExternalUrl, resolveNavigationTarget } from '@/lib/externalLinks';
import * as haptics from '@/lib/haptics';
import { KAKAO_BRIDGE_INJECTED_JS } from '@/lib/kakaoBridge';

const HOME_URL = APP_ORIGIN;

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

  // ⚠️ 아래 웹뷰 콜백들은 전부 useCallback 으로 고정한다.
  // 안드로이드의 shouldOverrideUrlLoading 은 링크를 누를 때마다 웹뷰의 UI
  // 스레드를 세우고 JS 스레드가 onShouldStartLoadWithRequest 에 답할 때까지
  // 최대 250ms 를 기다린다(RNCWebViewClient.java 의
  // SHOULD_OVERRIDE_URL_LOADING_TIMEOUT). 즉 JS 스레드가 바쁘면 그 대기 시간이
  // 그대로 "눌렀는데 늦게 반응함"으로 보인다. 콜백이 매 렌더마다 새로 만들어지면
  // 네이티브 웹뷰 prop 업데이트가 계속 발생해 JS 스레드를 괜히 태우므로
  // (useNetInfo 가 연결 상태 변화마다 이 컴포넌트를 리렌더한다) 참조를 고정한다.
  const onNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    canGoBack.current = navState.canGoBack;
    if (navState.url) currentUrl.current = navState.url;
  }, []);

  const { openNativeOAuth, flushPendingAuth } = useWebViewAuth(webViewRef, isLoaded, currentUrl);
  const { onMessage } = useNativeBridge(webViewRef, goTo);

  // 새 창 요청(target="_blank" 링크, window.open) 처리.
  // 안드로이드는 이 핸들러가 없으면 새 창을 화면에 붙지 않는 보이지 않는
  // 웹뷰에 열어버려서, 눌러도 아무 일도 없는 것처럼 보인다(iOS 는 정상).
  const onOpenWindow = useCallback(
    (event: WebViewOpenWindowEvent) => {
      const { targetUrl } = event.nativeEvent;
      if (isNativeOAuthStartUrl(targetUrl)) {
        openNativeOAuth(targetUrl);
      } else if (isWebViewNavigable(targetUrl) && isTrustedHost(targetUrl)) {
        goTo(targetUrl);
      } else {
        openExternalUrl(targetUrl);
      }
    },
    [goTo, openNativeOAuth],
  );

  // 신뢰 도메인(자사·결제·로그인)의 웹 URL만 웹뷰가 처리하고, 그 외 http(s) 최상위
  // 이동(외부 쇼핑몰 등)과 앱 스킴(intent://, tel:, kakaotalk:// 등)은 외부로 넘긴다.
  // (웹뷰가 앱 스킴을 직접 열면 ERR_UNKNOWN_URL_SCHEME 에러 화면이 뜬다.)
  const onShouldStartLoadWithRequest = useCallback(
    (request: ShouldStartLoadRequest) => {
      if (isNativeOAuthStartUrl(request.url)) {
        openNativeOAuth(request.url);
        return false;
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
    [openNativeOAuth],
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
  const onLoadProgress = useCallback(({ nativeEvent }: WebViewProgressEvent) => {
    if (nativeEvent.progress >= FIRST_PAINT_PROGRESS) setFirstLoadDone(true);
  }, []);

  const onLoadEnd = useCallback(() => {
    setFirstLoadDone(true);
    const failed = lastLoadFailed.current;
    lastLoadFailed.current = false;
    isLoaded.current = true;
    if (failed) return;
    // 토큰을 먼저 심는다 — 아래 pendingUrl 이동이 최종 목적지가 되더라도
    // localStorage 저장은 유지되므로 둘 다 살릴 수 있다.
    flushPendingAuth();
    if (pendingUrl.current) {
      const url = pendingUrl.current;
      pendingUrl.current = null;
      webViewRef.current?.injectJavaScript(
        `window.location.href = ${JSON.stringify(url)}; true;`,
      );
    }
  }, [flushPendingAuth]);

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
          injectedJavaScript={KAKAO_BRIDGE_INJECTED_JS}
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
          // androidLayerType 은 기본값(none)을 쓴다. "hardware" 로 두면 웹뷰
          // 전체가 GPU 텍스처 한 장으로 올라가는데, 세로로 긴 페이지에서는
          // 웹뷰 자체의 타일 렌더링을 방해해 스크롤·터치가 오히려 더 굼떠진다.
          // cacheMode 는 LOAD_DEFAULT(서버 캐시 헤더를 그대로 따름)를 유지한다 —
          // LOAD_CACHE_ELSE_NETWORK 로 두면 만료된 캐시까지 우선 쓰는 바람에
          // 적립금·포인트 잔액이 옛날 값으로 보일 수 있다. 첫 로드 체감은
          // 위 onLoadProgress 로 줄인다.
          // setSupportMultipleWindows 는 건드리지 않는다 — false 로 두면 위
          // onOpenWindow 가 아예 안 불려서 새 창 링크(target="_blank")가 먹통이 된다.
          cacheEnabled
          cacheMode="LOAD_DEFAULT"
          overScrollMode="never"
        />
      </SafeAreaView>
      {!firstLoadDone && !loadError && (
        <WebViewSplash />
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
});
