import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as haptics from '@/lib/haptics';

// 백그라운드에 이 시간(ms) 이상 머문 뒤 돌아오면 다시 잠근다.
// 잠깐 알림 확인 등으로 전환했을 때 매번 인증을 요구하지 않기 위함.
const RELOCK_AFTER_MS = 30_000;

// '다시 시도해도 절대 성공할 수 없는' 인증 실패들.
//
// ⚠️ 가장 흔한 경우: 사용자가 Face ID 권한 팝업에서 '허용 안 함'을 누른 것
// (iOS가 biometryNotAvailable을 돌려줘 'not_available'로 매핑된다). 이때
// 잠금 상태를 유지하면 '잠금 해제' 버튼이 같은 실패를 반복할 뿐이라 앱이
// 영구히 잠긴다 — 재설치 말고는 복구 수단이 없다. 심사자가 권한 팝업을
// 거부하면 앱을 아예 못 쓰므로 그대로 거절이다.
//
// 앱 잠금은 편의 기능이고 실제 보호는 서버 세션(JWT)이 한다. 그러니 인증이
// 구조적으로 불가능한 상황에서는 잠그지 않고 통과시킨다(= 안드로이드와 동일).
// 사용자가 직접 취소한 경우('user_cancel' 등)는 여기 넣지 않는다 — 재시도가
// 가능한 정상적인 잠금 상태다.
const UNRECOVERABLE_AUTH_ERRORS = new Set([
  'not_available', // 생체 인증 사용 불가 (권한 거부 포함)
  'not_enrolled', // 등록된 생체 정보 없음
  'passcode_not_set', // 기기 암호 미설정 → 암호 폴백도 불가
  'lockout_permanent', // 실패 누적으로 영구 잠김
  'invalid_context',
  'unknown',
]);

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

  // 잠금을 포기하고 앱을 열어준다. biometricEnabled도 내려서 백그라운드 복귀 시
  // 재잠금 경로까지 막는다 — 안 그러면 30초 뒤 돌아올 때마다 같은 실패를 반복한다.
  const giveUpLock = useCallback(() => {
    biometricEnabled.current = false;
    setState('unlocked');
  }, []);

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
      } else if (UNRECOVERABLE_AUTH_ERRORS.has(result.error)) {
        // 재시도가 무의미한 실패 — 잠금을 아예 해제하고 이후 재잠금도 하지 않는다.
        giveUpLock();
      } else {
        setState('locked');
      }
    } catch {
      // 인증 API 자체가 던지면 잠금 화면에 가둘 방법밖에 없어진다. 통과시킨다.
      giveUpLock();
    } finally {
      authInFlight.current = false;
    }
  }, [giveUpLock]);

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
