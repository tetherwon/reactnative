// 웹 미리보기(react-native-web) 전용 스텁 — react-native-google-mobile-ads 는
// 네이티브 전용이라 웹 번들에서 제외한다. 실제 앱 동작과 무관.
export function showRewardedAd(_adUnit: string, _userId: string): Promise<boolean> {
  return Promise.resolve(false);
}
