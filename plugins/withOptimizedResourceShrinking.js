// 최적화된 리소스 축소(optimized resource shrinking)를 켠다.
//
// 플레이 콘솔 "R8 최적화로 앱의 메모리 및 성능 개선 → 최적화된 리소스 축소가
// 사용 설정되지 않음" 경고를 해소하는 설정이다.
//
// enableShrinkResourcesInReleaseBuilds(= isShrinkResources)만으로는 '예전' 축소
// 파이프라인이 돈다. AGP 8.12부터 R8이 리소스까지 최적화 단계에서 함께 처리하는
// 새 파이프라인이 생겼고, 8.12~8.13에서는 이 gradle 속성으로 켜야 한다.
// AGP 9.0+ 부터는 기본값이라 이 속성이 필요 없다.
// https://developer.android.com/topic/performance/app-optimization/enable-app-optimization
//
// expo-build-properties 에는 임의의 gradle.properties 를 넣는 옵션이 없어
// config plugin 으로 직접 붙인다.
const { withGradleProperties } = require('expo/config-plugins');

const KEY = 'android.r8.optimizedResourceShrinking';

function withOptimizedResourceShrinking(config) {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;
    const existing = props.find((item) => item.type === 'property' && item.key === KEY);
    if (existing) {
      existing.value = 'true';
      return config;
    }
    props.push({
      type: 'comment',
      value:
        ' R8 이 리소스까지 최적화 단계에서 함께 처리하는 새 축소 파이프라인.' +
        ' AGP 8.12~8.13 에서만 필요하고 9.0+ 는 기본값이다.',
    });
    props.push({ type: 'property', key: KEY, value: 'true' });
    return config;
  });
}

module.exports = withOptimizedResourceShrinking;
