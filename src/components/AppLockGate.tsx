import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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
  // 앱 잠금은 iOS 전용 — 안드로이드는 첫 렌더부터 바로 통과시킨다.
  // ('checking'으로 시작하면 effect가 돌기 전 첫 프레임에 잠금 화면이
  //  번쩍여서, 스플래시 → 로딩 스피너 사이에 파란 화면이 끼어든다.)
  const [state, setState] = useState<LockState>(
    Platform.OS === 'ios' ? 'checking' : 'unlocked',
  );
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
      // 앱 잠금은 iOS에서만 사용한다.
      // (iOS는 App Store 4.2 대응용 네이티브 기능이 필요하지만,
      //  Android는 해당 정책이 없어 매번 인증을 요구하면 마찰만 커진다.)
      if (Platform.OS !== 'ios') {
        setState('unlocked');
        return;
      }
      // 이 조회가 실패하면(기기/OS 이슈) 'checking' 에 영원히 머물러 잠금 화면에
      // 갇힌다 — 재시도 버튼은 'locked' 일 때만 뜨므로 앱을 아예 못 쓴다.
      // 앱 잠금은 부가 기능이므로 판단이 불가능하면 통과시킨다(fail-open).
      let hasHardware = false;
      let enrolled = false;
      try {
        hasHardware = await LocalAuthentication.hasHardwareAsync();
        enrolled = await LocalAuthentication.isEnrolledAsync();
      } catch {
        if (!cancelled) setState('unlocked');
        return;
      }
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

  // children 은 잠금 상태와 무관하게 항상 마운트하고, 잠금 화면은 그 "위에"
  // 불투명 오버레이로 덮는다. 예전처럼 잠금이 풀린 뒤에야 children 을 렌더하면
  // 웹뷰가 인증이 끝난 다음에야 생성돼서 [스플래시 → 생체인증 → 그제서야 페이지
  // 요청 시작] 이 전부 직렬로 이어붙는다. 이렇게 두면 인증하는 동안 웹 페이지가
  // 뒤에서 미리 로드돼 인증 시간이 체감 지연에서 사라진다.
  // 오버레이가 화면 전체를 불투명하게 가리므로 콘텐츠 노출 방지는 그대로 유지되고,
  // 앱 전환기(App Switcher) 스냅샷에도 잠금 화면이 찍힌다.
  return (
    <View style={styles.root}>
      {children}
      {state !== 'unlocked' && (
        <SafeAreaView
          style={[StyleSheet.absoluteFill, styles.container]}
          edges={['top', 'bottom']}
        >
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
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
