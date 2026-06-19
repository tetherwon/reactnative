import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { registerForPushNotificationsAsync } from '@/lib/notifications';

const HOME_URL = 'https://shoppinglog.store';

export default function HomeScreen() {
  const webViewRef = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const isLoaded = useRef(false);
  const pendingUrl = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 웹뷰로 특정 URL 이동. 아직 첫 로드 전이면 보류했다가 onLoadEnd 에서 적용.
  const goTo = useCallback((url: string) => {
    if (isLoaded.current) {
      webViewRef.current?.injectJavaScript(
        `window.location.href = ${JSON.stringify(url)}; true;`,
      );
    } else {
      pendingUrl.current = url;
    }
  }, []);

  // 앱 시작 시 1회 푸시 알림 등록
  useEffect(() => {
    registerForPushNotificationsAsync();
  }, []);

  // 알림 탭 처리 — 웜(앱 켜진 상태) + 콜드스타트(앱 꺼진 상태에서 탭해 실행) 모두 커버.
  // data.url 이 있으면 해당 URL 로 웹뷰 이동.
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const url = lastResponse?.notification.request.content.data?.url;
    if (typeof url === 'string' && url.length > 0) {
      goTo(url);
    }
  }, [lastResponse, goTo]);

  // 안드로이드 하드웨어 뒤로가기 → 웹뷰 히스토리 뒤로
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  const onNavigationStateChange = (navState: WebViewNavigation) => {
    canGoBack.current = navState.canGoBack;
  };

  const onLoadEnd = () => {
    setLoading(false);
    isLoaded.current = true;
    // 콜드스타트로 보류된 알림 URL 이 있으면 지금 적용
    if (pendingUrl.current) {
      const url = pendingUrl.current;
      pendingUrl.current = null;
      webViewRef.current?.injectJavaScript(
        `window.location.href = ${JSON.stringify(url)}; true;`,
      );
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <WebView
        ref={webViewRef}
        source={{ uri: HOME_URL }}
        style={styles.webview}
        onNavigationStateChange={onNavigationStateChange}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={onLoadEnd}
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        domStorageEnabled
        javaScriptEnabled
      />
      {loading && (
        <View style={styles.loader} pointerEvents="none">
          <ActivityIndicator size="large" color="#208AEF" />
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
  },
});
