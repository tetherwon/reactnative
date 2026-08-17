// R8 최적화 패스를 실제로 켠다.
//
// Expo/RN 의 안드로이드 템플릿(app/build.gradle)은 기본 규칙 파일로
// `proguard-android.txt` 를 쓰는데, 이 파일 안에는 `-dontoptimize` 가 들어 있다.
// 그래서 enableMinifyInReleaseBuilds 를 켜도 "이름 축약·미사용 코드 제거"만 되고
// 최적화 패스(인라이닝, 클래스 병합, 분기 정리)는 통째로 꺼진 상태로 빌드된다.
// 플레이 콘솔의 "R8 구성으로 인해 메모리 사용량이 증가하고 성능이 저하될 수
// 있습니다" 권고가 정확히 이 상태를 가리킨다.
//
// 구글 공식 안내: 레거시 proguard-android.txt 대신 proguard-android-optimize.txt
// 를 쓸 것 — 전자는 최적화를 막고 AGP 9 부터는 지원되지 않는다.
// https://developer.android.com/topic/performance/app-optimization/enable-app-optimization
//
// (R8 full mode 는 AGP 8.0 부터 기본값이고 Expo 템플릿이 끄지 않으므로 이미 켜져 있다.
//  gradle.properties 에 android.enableR8.fullMode=false 가 없다는 것을 확인함.)
//
// ⚠️ 최적화가 실제로 돌기 시작하므로 리플렉션 기반 SDK 가 깨질 수 있다.
// app.config.js 의 extraProguardRules 에 카카오·애드팝콘·installreferrer·
// JavascriptInterface keep 규칙이 들어 있고, 릴리즈 빌드로 로그인/오퍼월/보상형
// 광고/푸시를 한 번씩 확인한 뒤 프로덕션에 올릴 것.
const { withAppBuildGradle } = require('expo/config-plugins');

const LEGACY = 'getDefaultProguardFile("proguard-android.txt")';
const OPTIMIZED = 'getDefaultProguardFile("proguard-android-optimize.txt")';

function withProguardOptimize(config) {
  return withAppBuildGradle(config, (config) => {
    const gradle = config.modResults.contents;

    if (gradle.includes(OPTIMIZED)) return config; // 이미 적용됨
    if (!gradle.includes(LEGACY)) {
      // 템플릿이 바뀌어 치환 대상을 못 찾은 경우. 조용히 넘어가면 최적화가 꺼진
      // 채로 빌드돼 원인을 찾기 어려우므로 빌드를 세운다.
      throw new Error(
        '[withProguardOptimize] app/build.gradle 에서 ' +
          `${LEGACY} 를 찾지 못했습니다. Expo 템플릿이 바뀐 것 같으니 ` +
          'plugins/withProguardOptimize.js 를 확인하세요.',
      );
    }

    config.modResults.contents = gradle.replace(LEGACY, OPTIMIZED);
    return config;
  });
}

module.exports = withProguardOptimize;
