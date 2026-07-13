import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 소셜 로그인 딥링크(webview://auth?token=...) 수용 게이트.
 *
 * 딥링크는 아무 앱/웹페이지나 쏠 수 있다. 출처 검증 없이 토큰을 심으면
 * 공격자가 자기 계정 토큰으로 피해자를 조용히 로그인시키거나(세션 픽세이션),
 * 쓰레기 토큰으로 강제 로그아웃시킬 수 있다. 그래서 앱이 직접 로그인을
 * 시작했을 때만 표식을 남기고, 라우터로 들어온 토큰은 표식이 있고 그로부터
 * 10분 이내일 때만 수용한다.
 *
 * 메모리 플래그로는 안 되는 이유: 막아야 할 상황이 "로그인 도중 안드로이드가
 * 앱 프로세스를 죽였다가 딥링크로 재시작"이라 프로세스 생존을 전제할 수 없다.
 * → AsyncStorage 에 영속화한다.
 */

const KEY = 'sl_oauth_pending_at';
const VALID_MS = 10 * 60 * 1000;

/** 로그인 플로우를 시작하기 직전에 호출한다. */
export async function markOAuthPending(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(Date.now()));
  } catch {
    // 저장 실패 시 콜드 스타트 복구만 안 될 뿐 로그인 자체는 진행된다.
  }
}

/**
 * 딥링크 토큰을 수용해도 되는지 확인하고 표식을 소모한다(1회용).
 * 표식이 없거나 10분이 지났으면 false — 토큰을 버려야 한다.
 */
export async function consumeOAuthPending(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw == null) return false;
    await AsyncStorage.removeItem(KEY);
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < VALID_MS;
  } catch {
    return false;
  }
}
