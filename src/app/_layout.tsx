import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AppLockGate from '@/components/AppLockGate';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <AppLockGate>
        {/* animation: 'none' — 탭 전환 시 우→좌 슬라이드 제거(하단 탭 앱은 즉시 전환이 기본) */}
        <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
      </AppLockGate>
    </SafeAreaProvider>
  );
}
