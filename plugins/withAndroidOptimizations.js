// Play Console '기술 품질 > R8 최적화' 경고 대응.
//
// expo-build-properties의 enableMinifyInReleaseBuilds/enableShrinkResourcesInReleaseBuilds
// 는 minifyEnabled·shrinkResources만 켠다. Play가 추가로 요구하는
//  - R8 full mode          (android.enableR8.fullMode)
//  - 최적화된 리소스 축소   (android.enableNewResourceShrinker.preciseShrinking)
// 는 gradle.properties 플래그라 expo-build-properties 스키마에 없다. 여기서 직접 넣는다.
//
// ⚠️ full mode는 최적화가 더 공격적이라 리플렉션 기반 SDK가 깨질 수 있다. 이 앱은
// app.config.js의 extraProguardRules에서 카카오/애드팝콘 등을 -keep 하고 있으므로
// 그 규칙이 유지되는 한 안전하다. 문제가 생기면 이 플러그인만 빼면 원복된다.
const { withGradleProperties } = require('expo/config-plugins');

const FLAGS = {
  'android.enableR8.fullMode': 'true',
  'android.enableNewResourceShrinker.preciseShrinking': 'true',
};

function withAndroidOptimizations(config) {
  return withGradleProperties(config, (c) => {
    for (const [key, value] of Object.entries(FLAGS)) {
      const existing = c.modResults.find(
        (item) => item.type === 'property' && item.key === key,
      );
      if (existing) {
        existing.value = value;
      } else {
        c.modResults.push({ type: 'property', key, value });
      }
    }
    return c;
  });
}

module.exports = withAndroidOptimizations;
