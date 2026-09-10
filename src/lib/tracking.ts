import { Platform } from 'react-native';
import { waitForStableActive, withNativePrompt } from './nativePrompts';

type TrackingModule = typeof import('expo-tracking-transparency');
let mod: TrackingModule | null | undefined;
let pending: Promise<boolean> | null = null;

function getModule(): TrackingModule | null {
  if (mod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('expo-tracking-transparency') as TrackingModule;
    } catch { mod = null; }
  }
  return mod;
}

export function ensureTrackingPermission(): Promise<boolean> {
  if (Platform.OS !== 'ios') return Promise.resolve(false);
  if (pending) return pending;
  const m = getModule();
  if (!m) return Promise.resolve(false);
  pending = withNativePrompt(async () => {
    let current = await m.getTrackingPermissionsAsync();
    for (let attempt = 0; attempt < 2 && current.status === 'undetermined'; attempt++) {
      await waitForStableActive();
      current = await m.requestTrackingPermissionsAsync();
    }
    return current.status === 'granted';
  }).catch(() => false).finally(() => { pending = null; });
  // Deduplicate in-flight requests only. Undetermined/errors must remain retryable.
  return pending;
}
