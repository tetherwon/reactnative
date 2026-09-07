const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync(new URL('../app.config.js', `file://${__filename}`), 'utf8');
function config(env) {
  const context = {
    process: { env }, module: { exports: {} },
    require: (name) => { assert.equal(name, 'fs'); return { existsSync: () => false }; },
    console: { warn: () => {} },
  };
  vm.runInNewContext(source, context);
  return context.module.exports.expo;
}
const valid = {
  EAS_BUILD: 'true', EAS_BUILD_PLATFORM: 'android',
  KAKAO_NATIVE_APP_KEY: '0123456789abcdef0123456789abcdef',
};

test('remote builds stop before producing an APK with a missing or blank Kakao key', () => {
  for (const key of ['', '   ']) {
    assert.throws(() => config({ ...valid, KAKAO_NATIVE_APP_KEY: key }), /KAKAO_NATIVE_APP_KEY/);
  }
});

test('local config inspection works without remote EAS secrets', () => {
  assert.equal(config({}).android.package, 'store.shoppinglog.app');
});

test('an AdMob ad unit ID is rejected as an application ID without leaking its value', () => {
  const wrong = 'ca-app-pub-1111111111111111/2222222222';
  assert.throws(() => config({ ...valid, ADMOB_ANDROID_APP_ID: wrong }), (error) => {
    assert.match(error.message, /ADMOB_ANDROID_APP_ID/);
    assert.equal(error.message.includes(wrong), false);
    return true;
  });
});

test('valid Android SDK configuration resolves without changing the fallback AdMob app ID', () => {
  const expo = config(valid);
  const ads = expo.plugins.find((entry) => Array.isArray(entry) && entry[0] === 'react-native-google-mobile-ads');
  assert.equal(ads[1].androidAppId, 'ca-app-pub-1856287061134936~8519744143');
});

test('APK builds use production credentials and a separate update channel', () => {
  const eas = JSON.parse(readFileSync(new URL('../eas.json', `file://${__filename}`), 'utf8'));
  const apk = { ...eas.build.production, ...eas.build.apk };
  assert.equal(apk.environment, 'production');
  assert.equal(apk.android.buildType, 'apk');
  assert.equal(apk.distribution, 'internal');
  assert.notEqual(apk.channel, eas.build.production.channel);
  assert.notEqual(apk.channel, eas.build.preview.channel);
});
