import { login } from '@react-native-seoul/kakao-login';
import { withNativePrompt } from './nativePrompts';

let pending: Promise<string> | null = null;

// ATT/notifications/Face ID must not present over the Kakao authentication UI.
export function loginWithKakao(): Promise<string> {
  if (pending) return pending;
  pending = withNativePrompt(async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        login(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('login_timeout')), 120000);
        }),
      ]);
      if (!result.accessToken) throw new Error('login_failed');
      return result.accessToken;
    } catch (error) {
      const detail = error as { code?: string; message?: string };
      if (detail.code === 'E_CANCELLED_OPERATION' || /cancel(l?ed|lation)?|취소/i.test(detail.message || '')) {
        throw new Error('cancelled');
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }).finally(() => { pending = null; });
  return pending;
}
