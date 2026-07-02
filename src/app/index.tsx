import { useNetInfo } from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
        ref={webViewRef}
        source={{ uri: HOME_URL }}
        style={styles.webview}
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
