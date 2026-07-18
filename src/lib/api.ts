import AsyncStorage from '@react-native-async-storage/async-storage';

// 하이브리드 네이티브 화면(혜택·룰렛 등)이 쓰는 서버 API 클라이언트.
// 인증은 웹뷰 쿠키 세션을 POST /api/auth/app-token 으로 교환한 Bearer JWT
// (index.tsx 의 토큰 핸드오프가 저장) — 웹과 같은 계정/세션을 공유한다.

export const BASE_URL = 'https://shoppinglog.store';

const TOKEN_KEY = 'sl_native_token';
const APP_CONFIG_KEY = 'sl_app_config_v1';

let cachedToken: string | null | undefined; // undefined = 아직 안 읽음

export async function getToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  try {
    cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

export async function setToken(token: string): Promise<void> {
  // 계정이 바뀌면(다른 토큰) 이전 계정의 SWR 캐시를 비운다 — 계정 전환 오염 방지
  if (cachedToken && cachedToken !== token) await purgeSwrCache();
  cachedToken = token;
  try {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch {}
}

export async function clearToken(): Promise<void> {
  cachedToken = null;
  try {
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {}
  await purgeSwrCache();
}

/** 동기 조회 — 내비게이션 인터셉트처럼 await 할 수 없는 곳용. getToken()이 한 번
 * 불린 뒤에만 값이 있다(앱 부팅 시 index.tsx 가 미리 불러 캐시를 채운다). */
export function getTokenSync(): string | null {
  return cachedToken === undefined ? null : cachedToken;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Bearer 인증 포함 fetch. 401이면 토큰을 지우고 ApiError(401)를 던진다 —
 * 화면은 이를 받아 웹뷰 폴백(게스트 상태)으로 처리한다. */
export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init?.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (res.status === 401) {
    await clearToken();
    throw new ApiError(401, '로그인이 필요해요.');
  }
  if (!res.ok) {
    let detail = '요청에 실패했어요.';
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

// ── SWR 캐시 (웹 SLUtils.swrJson 과 같은 패턴) ───────────────────────────────
// 마지막 응답을 AsyncStorage 에 저장해 화면 진입 즉시 그리고, 네트워크로 갱신한다.
// 할인로그처럼 자주 안 바뀌는 목록이 "불러오는 중"을 보여주지 않게 하는 용도.

const SWR_PREFIX = 'sl_swr_native:';

export async function purgeSwrCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(SWR_PREFIX));
    if (mine.length) await AsyncStorage.multiRemove(mine);
  } catch {}
}

/** 캐시가 있으면 onData(data, true)로 즉시 1회 호출한 뒤, 네트워크 응답으로
 * onData(data, false)를 다시 호출한다. 네트워크 실패 시 캐시가 이미 그려졌으면
 * 조용히 넘어가고, 캐시도 없었으면 에러를 던진다. */
export async function apiFetchSWR<T>(
  path: string,
  onData: (data: T, fromCache: boolean) => void,
  ttlMs = 10 * 60_000,
): Promise<void> {
  let served = false;
  try {
    const raw = await AsyncStorage.getItem(SWR_PREFIX + path);
    if (raw) {
      const obj = JSON.parse(raw) as { ts: number; data: T };
      if (obj && obj.data !== undefined && Date.now() - (obj.ts || 0) < ttlMs) {
        served = true;
        onData(obj.data, true);
      }
    }
  } catch {}
  try {
    const data = await apiFetch<T>(path);
    try {
      await AsyncStorage.setItem(SWR_PREFIX + path, JSON.stringify({ ts: Date.now(), data }));
    } catch {}
    onData(data, false);
  } catch (e) {
    if (!served) throw e;
  }
}

// ── 원격 설정 (/api/app-config) ──────────────────────────────────────────────
// native_screens: 서버가 지정한 "네이티브로 렌더할 화면" 목록. 네이티브 화면에서
// 사고가 나면 서버 관리자 API로 목록에서 빼서 스토어 재배포 없이 웹뷰로 롤백한다.

type AppConfig = { native_screens?: string[] };

let nativeScreens: string[] = [];

export function isNativeScreenEnabled(name: string): boolean {
  return nativeScreens.includes(name);
}

/** 부팅 시 1회: 캐시된 설정을 즉시 적용하고, 네트워크로 갱신한다. */
export async function loadAppConfig(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(APP_CONFIG_KEY);
    if (raw) {
      const cfg = JSON.parse(raw) as AppConfig;
      if (Array.isArray(cfg.native_screens)) nativeScreens = cfg.native_screens;
    }
  } catch {}
  try {
    const res = await fetch(`${BASE_URL}/api/app-config`);
    if (!res.ok) return;
    const cfg = (await res.json()) as AppConfig;
    if (Array.isArray(cfg.native_screens)) {
      nativeScreens = cfg.native_screens;
      try {
        await AsyncStorage.setItem(APP_CONFIG_KEY, JSON.stringify(cfg));
      } catch {}
    }
  } catch {}
}
