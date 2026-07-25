/**
 * 하이브리드 네이티브 화면 스위치 + 네이티브용 인증 토큰 저장소.
 *
 * - native_screens: 서버(/api/app-config)가 내려주는 "네이티브로 렌더할 화면" 목록.
 *   관리자 페이지에서 실시간 토글한다. RN은 여기 포함된 화면만 네이티브로 띄우고
 *   나머지는 웹뷰를 유지한다(사고 시 목록에서 빼면 다음 실행부터 웹뷰로 롤백).
 * - 토큰: 앱의 JWT는 원래 웹뷰 localStorage(sl_token)에만 있다. 네이티브 화면이
 *   API(/api/referral/* 등)를 Bearer로 부르려면 네이티브에도 미러링해야 한다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const API_BASE = 'https://shoppinglog.store';

const SCREENS_KEY = 'sl_native_screens';
const TOKEN_KEY = 'sl_token';

// ── native_screens ──────────────────────────────────────────────
let nativeScreens: string[] = [];
let bootLoaded = false;

/** 부팅 직후 라우팅 판단용 동기 조회 (AsyncStorage 캐시가 먼저 채워둔다). */
export function isNativeScreenSync(key: string): boolean {
  return nativeScreens.indexOf(key) !== -1;
}

/**
 * 앱 시작 시 1회 호출. 먼저 캐시로 즉시 채우고, 이어서 서버 최신값으로 갱신한다.
 */
export async function loadAppConfig(): Promise<string[]> {
  if (!bootLoaded) {
    bootLoaded = true;
    try {
      const cached = await AsyncStorage.getItem(SCREENS_KEY);
      if (cached) nativeScreens = JSON.parse(cached) as string[];
    } catch {
      // 무시 — 서버 fetch로 채운다
    }
  }
  try {
    const res = await fetch(API_BASE + '/api/app-config');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.native_screens)) {
        nativeScreens = data.native_screens.map((s: unknown) => String(s));
        try {
          await AsyncStorage.setItem(SCREENS_KEY, JSON.stringify(nativeScreens));
        } catch {
          // 캐시 저장 실패는 무시 (메모리 값은 이미 갱신됨)
        }
      }
    }
  } catch {
    // 오프라인/서버 오류 — 캐시값 유지
  }
  return nativeScreens;
}

// ── 네이티브 인증 토큰 ───────────────────────────────────────────
let cachedToken: string | null = null;

/** 웹뷰의 sl_token을 네이티브로 미러링(로그인/재로그인/로그아웃 시). */
export async function setNativeToken(token: string | null): Promise<void> {
  cachedToken = token || null;
  try {
    if (cachedToken) await AsyncStorage.setItem(TOKEN_KEY, cachedToken);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    // 무시
  }
}

/** 네이티브 화면이 API 호출에 쓸 Bearer 토큰. */
export async function getNativeToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}
