import { useNetInfo } from '@react-native-community/netinfo';
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

import ConnectionErrorView from '@/components/ConnectionErrorView';
import * as haptics from '@/lib/haptics';
import { registerForPushNotificationsAsync } from '@/lib/notifications';

const HOME_URL = 'https://shoppinglog.store';

export default function HomeScreen() {
  const webViewRef = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const isLoaded = useRef(false);
  const pendingUrl = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
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
    setLoading(true);
    webViewRef.current?.reload();
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
    // 하단은 화면 끝까지 꽉 채운다(웹페이지 자체 하단 메뉴가 시스템 내비게이션 바
    // 위에 자연스럽게 붙도록). 상단만 상태바/노치를 피하는 inset 적용.
    <SafeAreaView style={styles.container} edges={['top']}>
      <WebView
        ref={webViewRef}
        source={{ uri: HOME_URL }}
        style={styles.webview}
        onNavigationStateChange={onNavigationStateChange}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={onLoadEnd}
        // 네트워크 수준 로드 실패(예: 오프라인) → 네이티브 에러 화면 표시
        onError={() => {
          setLoading(false);
          setLoadError(true);
          haptics.error();
        }}
        // iOS 웹뷰 프로세스가 죽으면(메모리 부족 등) 자동 복구
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
      {loading && !loadError && (
        <View style={styles.loader} pointerEvents="none">
          <ActivityIndicator size="large" color="#208AEF" />
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
  },
});
