import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as haptics from '@/lib/haptics';

// 백그라운드에 이 시간(ms) 이상 머문 뒤 돌아오면 다시 잠근다.
// 잠깐 알림 확인 등으로 전환했을 때 매번 인증을 요구하지 않기 위함.
const RELOCK_AFTER_MS = 30_000;

type LockState = 'checking' | 'locked' | 'unlocked';

/**
 * 앱 전체를 생체 인증(Face ID / Touch ID / 지문)으로 보호하는 게이트.
 * - 기기에 생체 인증 하드웨어가 있고 등록돼 있을 때만 동작한다.
 *   (없으면 잠그지 않고 그대로 통과 → 일반 기기 사용자 불편 없음)
 * - 콜드 스타트 시, 그리고 백그라운드에 일정 시간 머문 뒤 복귀 시 다시 잠근다.
 * - 인증 실패 시 기기 암호(passcode)로 폴백되며, 사용자가 "잠금 해제"로 재시도 가능.
 *
 * 웹에서는 못 하는 네이티브 전용 기능으로, App Store 심사 4.2(Minimum Functionality)
 * 대응에도 도움이 된다.
 */
export default function AppLockGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LockState>('checking');
  const biometricEnabled = useRef(false);
  const backgroundedAt = useRef<number | null>(null);
  const authInFlight = useRef(false);

  const authenticate = useCallback(async () => {
    if (authInFlight.current) return;
    authInFlight.current = true;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: '쇼핑로그 잠금 해제',
        cancelLabel: '취소',
      });
      if (result.success) {
        haptics.success();
        setState('unlocked');
      } else {
        setState('locked');
      }
    } catch {
      setState('locked');
    } finally {
      authInFlight.current = false;
    }
  }, []);

  // 최초 1회: 생체 인증 사용 가능 여부 확인 후, 가능하면 잠그고 인증 시작.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (cancelled) return;
      if (hasHardware && enrolled) {
        biometricEnabled.current = true;
        setState('locked');
        authenticate();
      } else {
        setState('unlocked');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticate]);

  // 백그라운드 → 포그라운드 복귀 시 일정 시간 지났으면 다시 잠근다.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (!biometricEnabled.current) return;
      if (next === 'background' || next === 'inactive') {
        if (backgroundedAt.current === null) {
          backgroundedAt.current = Date.now();
        }
      } else if (next === 'active') {
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (since !== null && Date.now() - since >= RELOCK_AFTER_MS) {
          setState('locked');
          authenticate();
        }
      }
    });
    return () => sub.remove();
  }, [authenticate]);

  if (state === 'unlocked') {
    return <>{children}</>;
  }

  // 'checking' / 'locked' 모두 잠금 화면을 보여준다 (콘텐츠 노출 방지).
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Text style={styles.emoji}>🔒</Text>
        <Text style={styles.title}>쇼핑로그</Text>
        {state === 'locked' && (
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={() => {
              haptics.tap();
              authenticate();
            }}
            accessibilityRole="button"
            accessibilityLabel="잠금 해제"
          >
            <Text style={styles.buttonText}>잠금 해제</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#208AEF',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emoji: {
    fontSize: 44,
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 32,
  },
  button: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: '#208AEF',
    fontSize: 16,
    fontWeight: '600',
  },
});
