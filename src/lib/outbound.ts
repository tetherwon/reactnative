import { router } from 'expo-router';

import { apiFetch } from './api';
import { openExternalUrl } from './externalLinks';
import { requestWebNav } from './webNav';

// 진행 중 플래그 — 응답까지 200~500ms 동안 화면에 아무 피드백이 없어서 유저가
// 두 번 누르는 게 기본 행동이고, 그때마다 제휴 클릭이 1건씩 더 기록된다.
// 호출부마다 가드를 두면 빠뜨리기 쉬워(실제로 tickets.tsx만 있었다) 여기서 막는다.
let inFlight = false;

/**
 * 쿠팡 제휴 클릭을 딥링크로 연다.
 * /go/coupang?format=json 으로 제휴 클릭을 서버에 먼저 기록하고(Bearer 인증 → subId
 * 심긴 최종 link.coupang.com URL) 받은 딥링크를 openExternalUrl 로 열어 쿠팡 앱을
 * 바로 띄운다(웹뷰 경유 X). 전환 추적(subId → 캐시백)은 그대로 유지된다.
 * 요청 실패 시에만 웹뷰 경유(/go/coupang)로 폴백한다.
 *
 * 반환값: 실제로 클릭을 처리했으면 true, 중복 탭이라 무시했으면 false.
 */
export async function openCoupangOutbound(coupangUrl?: string): Promise<boolean> {
  if (inFlight) return false;
  inFlight = true;
  const extra = coupangUrl ? `&url=${encodeURIComponent(coupangUrl)}` : '';
  try {
    const d = await apiFetch<{ url?: string }>(`/go/coupang?format=json${extra}`);
    if (d?.url) {
      await openExternalUrl(d.url);
      return true;
    }
    // 200인데 url이 없는 경우: 위 요청이 이미 클릭을 기록했으므로 웹뷰(/go/coupang)로
    // 폴백하면 같은 탭에 클릭이 두 번 잡힌다. 기록은 됐으니 여기서 끝낸다.
    return true;
  } catch {
    // 요청 자체가 실패했을 때만 웹뷰 경유로 폴백한다(클릭이 아직 기록되지 않음).
    requestWebNav('/go/coupang');
    router.dismissTo('/');
    return true;
  } finally {
    inFlight = false;
  }
}
