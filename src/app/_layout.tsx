import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AppLockGate from '@/components/AppLockGate';
import { ensureTrackingPermission } from '@/lib/tracking';

export default function RootLayout() {
  // ATT runs before the other queued system prompts; interrupted attempts retry on resume.
  useEffect(() => {
    void ensureTrackingPermission();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void ensureTrackingPermission();
    });
    return () => sub.remove();
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
