import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

import AppLockGate from '@/components/AppLockGate';

export default function RootLayout() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="auto" />
      <AppLockGate>
        <Stack screenOptions={{ headerShown: false }} />
      </AppLockGate>
    </SafeAreaProvider>
  );
}
