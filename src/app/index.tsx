import { useNetInfo } from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Image,
  Platform,
  StyleSheet,
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
import {
  isTrustedHost,
  isWebViewNavigable,
  openExternalUrl,
} from '@/lib/externalLinks';
import * as haptics from '@/lib/haptics';
import { registerForPushNotificationsAsync } from '@/lib/notifications';

const HOME_URL = 'https://shoppinglog.store';

// 로딩 화면에 띄울 곰 이미지
const LOADING_BEAR = require('../../assets/images/loading-bear.png');

// 페이지가 자기 가시성 상태(document.visibilityState)를 앱으로 보고하게 하는 스크립트.
// 안드로이드 12+ 시스템 스플래시는 별도 윈도우라서, 스플래시 뒤에서 웹뷰가 만들어지면
// 크로미움이 페이지를 "hidden"으로 기록한 채 갇히는 기기(갤럭시 등)가 있다.
// hidden 상태의 페이지는 타이머·rAF 가 초당 1회 수준으로 스로틀되어
// 탭 이동 같은 JS 동작이 수 초~수십 초씩 늦어진다(앱 전환 한 번이면 풀리는 증상).
const VISIBILITY_REPORTER = `
  (function () {
    var report = function () {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'visibility',
          state: document.visibilityState,
        }));
      }
    };
    report();
    document.addEventListener('visibilitychange', report);
  })();
  true;
`;

// 가시성 복구용 웹뷰 재생성 최대 횟수 (무한 재생성 방지)
const VISIBILITY_REMOUNT_LIMIT = 2;

export default function HomeScreen() {
  const webViewRef = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const isLoaded = useRef(false);
  const pendingUrl = useRef<string | null>(null);
  const lastBackPress = useRef(0);
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);
  const remountCount = useRef(0);

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

  const onNavigationStateChange = (navState: WebViewNavigation) => {
    canGoBack.current = navState.canGoBack;
  };

  // 새 창 요청(target="_blank" 링크, window.open) 처리.
  // 안드로이드는 이 핸들러가 없으면 새 창을 화면에 붙지 않는 보이지 않는
  // 웹뷰에 열어버려서, 눌러도 아무 일도 없는 것처럼 보인다(iOS 는 정상).
  const onOpenWindow = useCallback(
    (event: WebViewOpenWindowEvent) => {
      const { targetUrl } = event.nativeEvent;
      if (isWebViewNavigable(targetUrl) && isTrustedHost(targetUrl)) {
        goTo(targetUrl);
      } else {
        openExternalUrl(targetUrl);
      }
    },
    [goTo],
  );

  // 페이지가 "hidden"으로 갇혔다는 보고를 받으면 웹뷰를 재생성해 정상 가시성으로 복구.
  // 앱이 실제로 화면에 떠 있는데(active) 페이지만 hidden 인 경우가 갇힌 상태다.
  // (사용자가 진짜로 앱을 백그라운드로 보낸 경우는 active 가 아니므로 건드리지 않는다.)
  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let data: { type?: string; state?: string };
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (data?.type !== 'visibility' || data.state !== 'hidden') return;
    if (AppState.currentState !== 'active') return;
    if (remountCount.current >= VISIBILITY_REMOUNT_LIMIT) return;
    remountCount.current += 1;
    // 스플래시가 완전히 사라진 뒤 다시 붙도록 잠깐 기다렸다가 재생성.
    setTimeout(() => {
      if (AppState.currentState !== 'active') return;
      isLoaded.current = false;
      setFirstLoadDone(false); // 재로딩 동안 곰 로딩 화면으로 덮기
      setWebViewKey((k) => k + 1);
    }, 500);
  }, []);

  // 웹 URL(http·https·javascript: 등)은 전부 웹뷰가 그대로 처리하고,
  // 앱 스킴(intent://, tel:, kakaotalk:// 등)만 외부 앱으로 넘긴다.
  // (웹뷰가 앱 스킴을 직접 열면 ERR_UNKNOWN_URL_SCHEME 에러 화면이 뜬다.)
  const onShouldStartLoadWithRequest = useCallback(
    (request: ShouldStartLoadRequest) => {
      if (isWebViewNavigable(request.url)) return true;
      openExternalUrl(request.url);
      return false;
    },
    [],
  );

  const onLoadEnd = () => {
    setFirstLoadDone(true);
    isLoaded.current = true;
    if (pendingUrl.current) {
      const url = pendingUrl.current;
      pendingUrl.current = null;
      webViewRef.current?.injectJavaScript(
        `window.location.href = ${JSON.stringify(url)}; true;`,
      );
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <WebView
        key={webViewKey}
        ref={webViewRef}
        source={{ uri: HOME_URL }}
        style={styles.webview}
        injectedJavaScriptBeforeContentLoaded={VISIBILITY_REPORTER}
        injectedJavaScript={VISIBILITY_REPORTER}
        onMessage={onMessage}
        onNavigationStateChange={onNavigationStateChange}
        onOpenWindow={onOpenWindow}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onLoadEnd={onLoadEnd}
        onError={() => {
          setFirstLoadDone(true);
          setLoadError(true);
          haptics.error();
        }}
        onContentProcessDidTerminate={() => webViewRef.current?.reload()}
        domStorageEnabled
        javaScriptEnabled
        allowsInlineMediaPlayback
      />
      {!firstLoadDone && !loadError && (
        <View style={styles.loader} pointerEvents="none">
          <Image
            source={LOADING_BEAR}
            style={styles.loadingBear}
            resizeMode="contain"
          />
          <ActivityIndicator
            size="large"
            color="#208AEF"
            style={styles.loadingSpinner}
          />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: '#ffffff',
  },
  loadingBear: {
    width: 200,
    height: 200,
  },
  loadingSpinner: {
    marginTop: 20,
  },
});
