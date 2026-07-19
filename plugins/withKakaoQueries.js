// Android 11(API 30)+ 패키지 가시성(package visibility) 정책 때문에, 매니페스트에
// <queries>로 명시하지 않은 패키지는 PackageManager로 설치 여부를 볼 수 없다.
// 카카오 SDK는 내부적으로 com.kakao.talk 설치 여부를 PackageManager.getPackageInfo()
// 로 확인해 앱-투-앱(원탭) 로그인 여부를 결정하는데, @react-native-seoul/kakao-login의
// config plugin은 이 <queries> 선언을 추가하지 않는다.
// → 콘솔 키 해시를 전부 맞게 등록해도, 매니페스트에 이 선언이 없으면 SDK가
//   "카카오톡 미설치"로 오판해 항상 웹뷰(아이디/비번) 로그인으로 폴백한다.
// 공식 카카오 안드로이드 가이드가 요구하는 최소 선언:
//   <queries><package android:name="com.kakao.talk" /></queries>
const { withAndroidManifest } = require('expo/config-plugins');

const KAKAOTALK_PACKAGE = 'com.kakao.talk';

function withKakaoQueries(config) {
  return withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    manifest.queries = manifest.queries || [];
    const already = manifest.queries.some((q) =>
      (q.package || []).some((p) => p.$['android:name'] === KAKAOTALK_PACKAGE),
    );
    if (!already) {
      manifest.queries.push({ package: [{ $: { 'android:name': KAKAOTALK_PACKAGE } }] });
    }
    return c;
  });
}

module.exports = withKakaoQueries;
