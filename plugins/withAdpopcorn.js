// 애드팝콘 오퍼월 매체 키 · 해시 키를 AndroidManifest.xml <application> 에 주입한다.
//
// react-native-adpopcorn-reward 는 이 값을 위한 Expo config plugin을 제공하지
// 않고, 네이티브 Android 모듈의 setAppKey()/setLogEnable() 은 no-op이다
// (RNAdPopcornRewardModule.java: "android is not supported. use AndroidManifest.xml").
// 그래서 manifest mod를 직접 작성한다. iOS는 반대로 JS의 setAppKey() 호출로
// 설정한다 (src/lib/adpopcorn.ts 참고).
const { withAndroidManifest } = require('expo/config-plugins');

function setMetaData(app, name, value) {
  app['meta-data'] = app['meta-data'] || [];
  const existing = app['meta-data'].find((m) => m.$['android:name'] === name);
  if (existing) {
    existing.$['android:value'] = value;
  } else {
    app['meta-data'].push({ $: { 'android:name': name, 'android:value': value } });
  }
}

function withAdpopcorn(config, { appKey, hashKey }) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0];
    setMetaData(app, 'adpopcorn_app_key', appKey || '');
    setMetaData(app, 'adpopcorn_hash_key', hashKey || '');
    return config;
  });
}

module.exports = withAdpopcorn;
