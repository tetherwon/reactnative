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

import ConnectionErrorView from '@/components/ConnectionErrorView';
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
  // 초기 로딩에만 곰 화면을 띄운다(매 이동마다 띄우면 SPA에서 화면이 덮일 위험).
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // 네트워크 상태 감지 — isConnected 가 명시적으로 false 일 때만 오프라인으로 본다.
  const { isConnected } = useNetInfo();
  const isOffline = isConnected === false;

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

  // 에러/오프라인 화면에서 "다시 시도" → 웹뷰 리로드.
  const handleRetry = useCallback(() => {
    setLoadError(false);
    setFirstLoadDone(false);
    webViewRef.current?.reload();
  }, []);

  // 앱 시작 시 1회 푸시 알림 등록
  useEffect(() => {
    registerForPushNotificationsAsync();
  }, []);

  // 알림 탭 처리 — 웜(앱 켜진 상태) + 콜드스타트(앱 꺼진 상태에서 탭해 실행) 모두 커버.
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const url = lastResponse?.notification.request.content.data?.url;
    if (typeof url === 'string' && url.length > 0) {
      haptics.success();
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
      const now = Date.now();
      if (now - lastBackPress.current < 2000) {
        return false; // 기본 동작(앱 종료) 허용
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
        onLoadEnd={onLoadEnd}
        onError={() => {
          setFirstLoadDone(true);
          setLoadError(true);
          haptics.error();
        }}
        onContentProcessDidTerminate={() => webViewRef.current?.reload()}
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        domStorageEnabled
        javaScriptEnabled
        // 상품 사진 업로드(<input type="file"> / getUserMedia) 지원
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        allowsInlineMediaPlayback
        allowFileAccess
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
