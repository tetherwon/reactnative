import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AppLockGate from '@/components/AppLockGate';
import { ensureTrackingPermission } from '@/lib/tracking';

export default function RootLayout() {
  // ATT 동의는 앱 첫 실행 직후, 로그인보다 먼저 묻는다. 규정상 추적 데이터를
  // 만지기 전에 물어야 하고, 심사자도 이 순서라야 확실히 보게 된다.
  // (실제 팝업 타이밍은 tracking.ts 가 AppState=active 이후로 맞춘다 —
  //  여기서 곧바로 부르면 앱이 아직 active 가 아니라 iOS 가 팝업을 씹는다.)
  useEffect(() => {
    ensureTrackingPermission();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <AppLockGate>
        <Stack screenOptions={{ headerShown: false }} />
      </AppLockGate>
    </SafeAreaProvider>
  );
}
