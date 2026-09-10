import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { APP_ORIGIN, isNativeOAuthStartUrl } from './externalLinks';

const KEY = 'sl_oauth_pkce_v1';
const VALID_MS = 10 * 60 * 1000;
type PendingAuth = { state: string; verifier: string; at: number };
let tail: Promise<unknown> = Promise.resolve();

function exclusive<T>(action: () => Promise<T>): Promise<T> {
  const result = tail.then(action);
  tail = result.catch(() => undefined);
  return result;
}

async function randomHex(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('');
}

export function beginOAuth(rawUrl: string): Promise<{ url: string; state: string }> {
  return exclusive(async () => {
    if (!isNativeOAuthStartUrl(rawUrl)) throw new Error('Invalid login URL');
    const state = await randomHex();
    const verifier = await randomHex();
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier,
      { encoding: Crypto.CryptoEncoding.BASE64 });
    const challenge = digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await SecureStore.setItemAsync(KEY, JSON.stringify({ state, verifier, at: Date.now() }),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    const url = new URL(rawUrl);
    url.searchParams.set('app', '1');
    url.searchParams.set('app_state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return { url: url.toString(), state };
  });
}

export function cancelOAuth(state: string): Promise<void> {
  return exclusive(async () => {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw && JSON.parse(raw).state === state) await SecureStore.deleteItemAsync(KEY);
  });
}

export function exchangeOAuthCode(code: string, state: string): Promise<string | null> {
  return exclusive(async () => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(code) || !/^[a-f0-9]{64}$/.test(state)) return null;
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    let pending: PendingAuth;
    try { pending = JSON.parse(raw); } catch { await SecureStore.deleteItemAsync(KEY); return null; }
    if (pending.state !== state) return null;
    const age = Date.now() - pending.at;
    if (!Number.isFinite(age) || age < 0 || age >= VALID_MS) {
      await SecureStore.deleteItemAsync(KEY);
      return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      // No session cookies: possession of the per-attempt verifier is required.
      const response = await fetch(APP_ORIGIN + '/api/auth/app-exchange', {
        method: 'POST', credentials: 'omit', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state, code_verifier: pending.verifier }),
      });
      if (!response.ok) throw new Error('Login exchange failed');
      const result = await response.json();
      return typeof result.token === 'string' && result.token ? result.token : null;
    } finally {
      clearTimeout(timer);
      await SecureStore.deleteItemAsync(KEY);
    }
  });
}
