/**
 * 보상형 광고(AdMob) — 웹 충전소의 {type:"admob:showRewarded"} 메시지 대응.
 *
 * 적립 자체는 Google이 백엔드(/api/charge/admob-ssv)로 직접 보내는 서명된
 * SSV 콜백이 처리한다. 여기서 웹에 돌려주는 boolean은 UI 갱신용일 뿐이다.
 * (전체 프로토콜: Shopping_log 레포 docs/RN_BRIDGE.md)
 *
 * react-native-google-mobile-ads는 네이티브 모듈이라, 모듈이 없는 바이너리
 * (구버전 앱, ADMOB_ANDROID_APP_ID 없이 만든 빌드)에서 import 시점에 죽지
 * 않도록 require를 try/catch로 감싼다. 모듈이 없으면 광고 없이 false를
 * 돌려준다 → 웹은 "광고를 불러오지 못했어요"로 처리.
 */

type GoogleMobileAds = typeof import('react-native-google-mobile-ads');

let ads: GoogleMobileAds | null | undefined;

function getAds(): GoogleMobileAds | null {
  if (ads === undefined) {
    try {
      // 정적 import 는 모듈이 없는 바이너리에서 앱 시작 자체를 죽인다.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ads = require('react-native-google-mobile-ads') as GoogleMobileAds;
    } catch {
      ads = null;
    }
  }
  return ads;
}

let initPromise: Promise<unknown> | null = null;

/**
 * 보상형 광고를 로드·표시하고, 사용자가 보상을 얻었는지 여부를 돌려준다.
 * 실패(모듈 없음, 로드 실패, 중도 이탈)는 전부 false — 절대 reject 하지 않는다.
 * 웹(charge.js)이 90초 타임아웃을 갖고 있으므로 그보다 짧은 60초 안전망을 둔다.
 */
export function showRewardedAd(adUnit: string, userId: string): Promise<boolean> {
  const mod = getAds();
  if (!mod || !adUnit) return Promise.resolve(false);

  if (!initPromise) {
    initPromise = mod.default().initialize().catch(() => {});
  }

  return initPromise.then(
    () =>
      new Promise<boolean>((resolve) => {
        const { RewardedAd, RewardedAdEventType, AdEventType } = mod;
        const ad = RewardedAd.createForAdRequest(adUnit, {
          // SSV 콜백의 user_id로 그대로 전달돼 서버가 적립 대상을 식별한다.
          serverSideVerificationOptions: { userId, customData: userId },
        });

        let rewarded = false;
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unsubLoaded();
          unsubEarned();
          unsubClosed();
          unsubError();
          resolve(rewarded);
        };

        const unsubLoaded = ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
          ad.show().catch(done);
        });
        const unsubEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
          rewarded = true;
        });
        const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, done);
        const unsubError = ad.addAdEventListener(AdEventType.ERROR, done);
        const timer = setTimeout(done, 60_000);

        ad.load();
      }),
  );
}
