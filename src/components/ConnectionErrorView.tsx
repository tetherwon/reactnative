import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as haptics from '@/lib/haptics';

type Props = {
  /** 제목 */
  title?: string;
  /** 설명 문구 */
  message?: string;
  /** 다시 시도 버튼 콜백 */
  onRetry: () => void;
};

/**
 * 네트워크 끊김/페이지 로드 실패 시 깨진 WebView 대신 보여주는 네이티브 화면.
 * (App Store 심사는 비행기모드에서도 앱을 켜보므로, 흰 화면 대신 이 화면이 떠야 한다.)
 */
export default function ConnectionErrorView({
  title = '연결할 수 없어요',
  message = '인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
  onRetry,
}: Props) {
  const handleRetry = () => {
    haptics.tap();
    onRetry();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Text style={styles.emoji}>📡</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={handleRetry}
          accessibilityRole="button"
          accessibilityLabel="다시 시도"
        >
          <Text style={styles.buttonText}>다시 시도</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    color: '#666666',
    textAlign: 'center',
    marginBottom: 28,
  },
  button: {
    backgroundColor: '#208AEF',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
