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
