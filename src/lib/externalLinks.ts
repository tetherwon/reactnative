import { Linking, Platform } from 'react-native';

// 웹/JS 관련 URL 은 전부 웹뷰가 직접 처리한다.
// javascript:/file: 까지 포함해야 JS로 동작하는 버튼·탭·링크가 막히지 않는다.
// 그 외(intent://, tel:, mailto:, kakaotalk:// 등 진짜 앱 스킴)만 외부로 넘긴다.
export function isWebViewNavigable(url: string): boolean {
  return /^(https?:|about:|blob:|data:|javascript:|file:)/i.test(url);
}

// 앱 웹뷰 안에서 열어도 되는 "신뢰 도메인" 목록.
// 여기 없는 http(s) 사이트는 시스템 브라우저로 보낸다(아래 isTrustedHost 참고).
// ⚠️ 결제/로그인 도중 외부 브라우저로 튕기면, 그 도메인을 여기에 추가해야 한다.
const TRUSTED_HOSTS = [
  'shoppinglog.store',
  // 결제/PG
  'kakao.com', 'kakaopay.com', 'kakaocdn.net', 'daum.net',
  'toss.im', 'tosspayments.com',
  'naver.com', 'pay.naver.com', 'payco.com',
  'nicepay.co.kr', 'nicepay.com', 'inicis.com', 'kcp.co.kr',
  'settlebank.co.kr', 'danalpay.com', 'danal.co.kr', 'mobilians.co.kr',
  // 소셜 로그인/인증
  'google.com', 'gstatic.com', 'googleapis.com',
  'apple.com', 'icloud.com',
  'facebook.com', 'kakao.co.kr',
];

function getHost(url: string): string {
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
  return m ? m[1].toLowerCase().replace(/:\d+$/, '') : '';
}

/**
 * 신뢰 도메인(자사 + 결제·로그인 제공자)인지 판단.
 * 신뢰 도메인만 웹뷰 안에서 열고, 그 외는 시스템 브라우저로 보내
 * 사용자가 "진짜 주소창"을 보고 브라우저의 피싱 보호를 받게 한다.
 */
export function isTrustedHost(url: string): boolean {
  const host = getHost(url);
  if (!host) return false;
  return TRUSTED_HOSTS.some((d) => host === d || host.endsWith('.' + d));
}

// 구글은 임베디드 웹뷰 안에서의 OAuth 로그인 시도를 자체 차단한다
// (Error 403: disallowed_useragent). /auth/google "시작 경로"로 가는
// 이동을 통째로 시스템 인증 세션(Custom Tab/SFSafariViewController) 하나로
// 열어야 한다 — 자사→구글→자사 콜백 도중에 웹뷰로 갈아타면, 로그인 시작 시
// 웹뷰 쿠키 저장소에 심어둔 state/app 쿠키를 콜백이 못 봐서
// state_mismatch로 깨진다(웹뷰와 시스템 브라우저는 쿠키 저장소가 다름).
const NATIVE_OAUTH_START_PATHS = ['https://shoppinglog.store/auth/google'];

export function isNativeOAuthStartUrl(url: string): boolean {
  return NATIVE_OAUTH_START_PATHS.some((prefix) => url.startsWith(prefix));
}

// 웹뷰 안에서 진행되는 소셜 로그인 플로우(애플, 카카오 웹 폴백 등)의 시작/콜백
// 경로. 이 플로우는 마지막에 webview://auth 딥링크로 끝나는데, 딥링크 토큰은
// 앱이 로그인을 시작했다는 표식(authGate)이 있어야만 수용되므로, 이 경로로의
// 이동을 볼 때 표식을 남겨야 한다.
export function isOAuthWebStartUrl(url: string): boolean {
  return url.startsWith('https://shoppinglog.store/auth/');
}

// 안드로이드에서 외부 브라우저로 다운로드시킬 문서 확장자.
// (이미지(jpg/png)는 쿼리스트링 오탐 위험이 있어 제외 — 웹뷰에서 봐도 무방)
const DOWNLOAD_EXT = /\.(pdf|xlsx?|csv|zip|hwp|docx?|pptx?)(\?|#|$)/i;

export function isDownloadUrl(url: string): boolean {
  return /^https?:/i.test(url) && DOWNLOAD_EXT.test(url);
}

// intent:// URL 에서 브라우저 폴백 주소 추출 (예: 결제/인증 앱 미설치 시)
function extractIntentFallback(intentUrl: string): string | null {
  const m = intentUrl.match(/S\.browser_fallback_url=([^;]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

// intent:// URL 에서 패키지명 추출 → 마켓 설치 페이지로 유도
function extractIntentMarket(intentUrl: string): string | null {
  const m = intentUrl.match(/package=([^;]+)/);
  return m ? `market://details?id=${m[1]}` : null;
}

/**
 * 웹뷰가 처리 못 하는 URL(앱 스킴, mailto, tel, intent:// 등)을 외부에서 연다.
 * - 카카오페이/토스/이니시스 등 결제·본인인증 앱 호출(app-to-app) 대응
 * - 설치 안 된 앱은 마켓/폴백 주소로 유도, 그래도 안 되면 조용히 무시
 */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    if (Platform.OS === 'android' && url.startsWith('intent://')) {
      const fallback = extractIntentFallback(url);
      if (fallback) {
        await Linking.openURL(fallback);
        return;
      }
      try {
        await Linking.openURL(url); // 일부 기기는 intent:// 직접 처리 가능
        return;
      } catch {
        const market = extractIntentMarket(url);
        if (market) await Linking.openURL(market);
        return;
      }
    }

    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) await Linking.openURL(url);
  } catch {
    // 설치되지 않은 앱 등 — 무시 (앱이 죽지 않도록)
  }
}
