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
    // AdPopcornOfferwall(IGAWorks) SDK가 읽는 meta-data 이름은 igaworks_* 다.
    // (공식 샘플 igaworks-release/IgawAdpopcornOfferwall{Server,Client}Sample 기준)
    // 이전에 쓰던 adpopcorn_app_key/adpopcorn_hash_key는 SDK가 못 읽어 앱키가
    // 빈 값이 되고, 오퍼월이 '빈 목록'으로 열리던 버그의 원인이었다.
    setMetaData(app, 'igaworks_app_key', appKey || '');
    setMetaData(app, 'igaworks_hash_key', hashKey || '');
    // 리워드는 서버-서버 포스트백(/api/adpopcorn/postback, HMAC-MD5)으로 지급하므로
    // 서버 타입을 명시한다. (애드팝콘 대시보드의 리워드 지급 방식도 '서버'여야 함)
    setMetaData(app, 'igaworks_reward_server_type', 'server');
    return config;
  });
}

module.exports = withAdpopcorn;
