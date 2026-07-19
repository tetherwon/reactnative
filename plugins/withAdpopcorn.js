// 애드팝콘(IGAWorks AdPopcorn Offerwall) 매체 키·해시 키를 AndroidManifest.xml
// <application> 에 주입한다.
//
// react-native-adpopcorn-reward 는 Expo config plugin을 제공하지 않고, 네이티브
// Android 모듈의 setAppKey() 는 no-op이다(RNAdPopcornRewardModule.java:
// "android is not supported. use AndroidManifest.xml"). 그래서 manifest mod를 직접 쓴다.
// iOS는 반대로 JS의 setAppKey() 호출로 설정한다(src/lib/adpopcorn.ts).
//
// ⚠️ 두 가지가 중요하다(둘 다 틀리면 오퍼월은 열려도 "네트워크 오류"로 광고를 못 받는다):
//  1) SDK가 읽는 meta-data 이름은 `igaworks_app_key` / `igaworks_hash_key` 다
//     (공식 문서 기준). 예전엔 `adpopcorn_*` 로 잘못 넣어 키를 못 읽었다.
//  2) 앱키가 전부 숫자면 android:value 에 그대로 넣을 때 aapt가 int로 파싱해
//     ApplicationInfo.metaData.getString() 이 null 을 반환한다. → 값을 문자열
//     리소스로 넣고 @string/ 로 참조해 항상 문자열로 읽히게 한다.
const { withAndroidManifest, withStringsXml } = require('expo/config-plugins');

const APP_KEY_RES = 'igaw_app_key';
const HASH_KEY_RES = 'igaw_hash_key';
const META_APP_KEY = 'igaworks_app_key';
const META_HASH_KEY = 'igaworks_hash_key';

function setStringRes(strings, name, value) {
  const res = strings.resources;
  res.string = (res.string || []).filter((s) => s.$.name !== name);
  res.string.push({ $: { name, translatable: 'false' }, _: value });
  return strings;
}

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
  // 1) 값은 문자열 리소스로 저장(숫자 앱키가 int로 파싱되는 것 방지)
  config = withStringsXml(config, (c) => {
    c.modResults = setStringRes(c.modResults, APP_KEY_RES, appKey || '');
    c.modResults = setStringRes(c.modResults, HASH_KEY_RES, hashKey || '');
    return c;
  });
  // 2) SDK가 읽는 meta-data 이름으로 리소스를 참조
  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application[0];
    setMetaData(app, META_APP_KEY, `@string/${APP_KEY_RES}`);
    setMetaData(app, META_HASH_KEY, `@string/${HASH_KEY_RES}`);
    return c;
  });
  return config;
}

module.exports = withAdpopcorn;
