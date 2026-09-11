const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function config(env) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app.config.js'), 'utf8'), {
    module, process: { env }, console: { warn() {} },
    require: name => {
      assert.equal(name, 'fs');
      return { existsSync: () => false };
    },
  });
  return module.exports.expo;
}

// 카카오 SDK 는 로그인 버튼이 아니라 앱이 뜰 때 초기화되므로, 키가 빈 바이너리는
// 아이콘을 누르는 즉시 죽는다. EAS 환경변수를 깜빡해도 그런 빌드가 나오지 않도록
// 폴백 상수를 둔다. (앱 키는 APK/IPA 에 어차피 평문으로 박히는 공개값이고,
// 실제 방어는 콘솔에 등록된 패키지명 + 키 해시가 맡는다.)
function kakaoKeyOf(expo) {
  const plugin = expo.plugins.find(
    entry => Array.isArray(entry) && entry[0] === '@react-native-seoul/kakao-login',
  );
  return plugin[1].kakaoAppKey;
}

test('native builds always carry a non-empty Kakao key, even with no env var', () => {
  for (const platform of ['ios', 'android']) {
    for (const key of [undefined, '', '  ']) {
      const expo = config({
        EAS_BUILD_PLATFORM: platform,
        KAKAO_NATIVE_APP_KEY: key,
        ADMOB_IOS_APP_ID: 'ca-app-pub-3940256099942544~1458002511',
      });
      assert.match(kakaoKeyOf(expo), /^[0-9a-f]{32}$/);
    }
  }
});

test('an explicit Kakao key still overrides the fallback', () => {
  assert.equal(kakaoKeyOf(config({ KAKAO_NATIVE_APP_KEY: 'env-supplied-key' })), 'env-supplied-key');
});

test('iOS builds require their AdMob app ID; Android and local exports remain available', () => {
  const env = { EAS_BUILD_PLATFORM: 'ios', KAKAO_NATIVE_APP_KEY: 'test-kakao-key' };
  for (const id of [undefined, '', '  ']) {
    assert.throws(() => config({ ...env, ADMOB_IOS_APP_ID: id }), /ADMOB_IOS_APP_ID/);
  }
  assert.equal(config({ ...env, ADMOB_IOS_APP_ID: 'ca-app-pub-3940256099942544~1458002511' }).ios.bundleIdentifier, 'store.shoppinglog.app');
  assert.equal(config({ ...env, EAS_BUILD_PLATFORM: 'android' }).android.package, 'store.shoppinglog.app');
  assert.equal(config({}).slug, 'webview');
});
