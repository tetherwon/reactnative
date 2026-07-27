import { router } from 'expo-router';

import { apiFetch } from './api';
import { openExternalUrl } from './externalLinks';
import { requestWebNav } from './webNav';

/**
 * 쿠팡 제휴 클릭을 딥링크로 연다.
 * /go/coupang?format=json 으로 제휴 클릭을 서버에 먼저 기록하고(Bearer 인증 → subId
 * 심긴 최종 link.coupang.com URL) 받은 딥링크를 openExternalUrl 로 열어 쿠팡 앱을
 * 바로 띄운다(웹뷰 경유 X). 전환 추적(subId → 캐시백)은 그대로 유지된다.
 * 요청 실패 시에만 웹뷰 경유(/go/coupang)로 폴백한다.
 */
export async function openCoupangOutbound(coupangUrl?: string): Promise<void> {
  const extra = coupangUrl ? `&url=${encodeURIComponent(coupangUrl)}` : '';
  try {
    const d = await apiFetch<{ url?: string }>(`/go/coupang?format=json${extra}`);
    if (d?.url) {
      await openExternalUrl(d.url);
      return;
    }
  } catch {
    // 아래 웹뷰 폴백으로
  }
  requestWebNav('/go/coupang');
  router.dismissTo('/');
}
