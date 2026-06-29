import { useNetInfo } from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  StyleSheet,
  ToastAndroid,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import ConnectionErrorView from '@/components/ConnectionErrorView';
import {
  isDownloadUrl,
  isWebViewNavigable,
  openExternalUrl,
} from '@/lib/externalLinks';
import * as haptics from '@/lib/haptics';
import { registerForPushNotificationsAsync } from '@/lib/notifications';

const HOME_URL = 'https://shoppinglog.store';

// 구글 OAuth 등은 "임베디드 웹뷰"를 감지하면 로그인을 막는다(403, disallowed_useragent).
// 웹뷰 표식이 없는 일반 브라우저 User-Agent 로 위장해 이를 우회한다.
// 끝에 'ShoppingLogApp' 식별자를 붙여, 웹사이트가 "앱 안"임을 감지할 수 있게 한다.
// (예: 카카오 로그인을 앱에서는 웹 로그인으로 강제 → throughTalk:false)
const BASE_UA =
  Platform.OS === 'ios'
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    : 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const USER_AGENT = `${BASE_UA} ShoppingLogApp/1.0`;

export default function HomeScreen() {
  const webViewRef = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const isLoaded = useRef(false);
  const pendingUrl = useRef<string | null>(null);
  const lastBackPress = useRef(0);
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
      // 더 뒤로 갈 곳이 없으면, 한 번 더 눌러야 종료(실수 종료 방지)
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

  // 모든 이동 요청의 라우터:
  // - 앱 스킴(intent://, kakaotalk://, tel:, mailto: 등) → 외부 앱/브라우저로 (결제·인증 대응)
  // - 안드로이드 문서 다운로드(.pdf 등) → 외부 브라우저가 받게
  // - 그 외 http(s)/about/blob/data → 웹뷰에서 그대로 로드(내부 탭 이동 정상 동작)
  //
  // ⚠️ 도메인 화이트리스트는 내부 탭 이동까지 막아 흰 화면을 유발해 제거했다.
  // 보안(피싱) 강화가 필요하면 "현재 페이지와 다른 외부 도메인의 새 창"만
  // 골라 외부로 보내는 방식으로 다시 설계할 것.
  const onShouldStartLoadWithRequest = (req: WebViewNavigation) => {
    const { url } = req;
    if (!isWebViewNavigable(url)) {
      openExternalUrl(url);
      return false;
    }
    if (Platform.OS === 'android' && isDownloadUrl(url)) {
      openExternalUrl(url);
      return false;
    }
    return true;
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
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        // iOS 다운로드(영수증/기프티콘 등) → 외부에서 처리
        onFileDownload={({ nativeEvent }) => openExternalUrl(nativeEvent.downloadUrl)}
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
        // 구글 로그인(OAuth) 403 회피: 브라우저처럼 보이는 UA + 쿠키 공유
        userAgent={USER_AGENT}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        // OAuth 팝업(target=_blank / window.open)을 같은 웹뷰에서 처리
        setSupportMultipleWindows={false}
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
