import { useNetInfo } from '@react-native-community/netinfo';
import { login as kakaoLogin } from '@react-native-seoul/kakao-login';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
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
import {
  KAKAO_BRIDGE_INJECTED_JS,
  KAKAO_BRIDGE_MESSAGE_TYPE,
  rejectKakaoLoginScript,
  resolveKakaoLoginScript,
} from '@/lib/kakaoBridge';
import { registerForPushNotificationsAsync } from '@/lib/notifications';

const HOME_URL = 'https://shoppinglog.store';

// 로딩 화면을 네이티브 스플래시와 동일하게 보이도록 같은 이미지를 사용한다.
// (스플래시 → 로딩 → 홈 전환이 화면 전환처럼 보이지 않게 하기 위함)
const SPLASH_IMAGE = require('../../assets/images/splash.png');

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

  // 웹의 window.Capacitor.Plugins.KakaoAuth.login() 호출을 postMessage 로 받아
  // 네이티브 카카오 SDK 로그인을 실행하고, 결과를 웹의 Promise로 되돌려준다.
  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let data: { type?: string; id?: string };
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
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
  }, []);

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
          injectedJavaScriptBeforeContentLoaded={KAKAO_BRIDGE_INJECTED_JS}
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
      </SafeAreaView>
      {!firstLoadDone && !loadError && (
        <View style={styles.loader} pointerEvents="none">
          <Image
            source={SPLASH_IMAGE}
            style={styles.loadingImage}
            resizeMode="contain"
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
    backgroundColor: '#ffffff',
  },
  loadingImage: {
    width: '100%',
    height: '100%',
  },
});
