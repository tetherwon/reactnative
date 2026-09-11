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

test('native builds reject missing Kakao key before creating an unusable binary', () => {
  for (const platform of ['ios', 'android']) {
    for (const key of [undefined, '', '  ']) {
      assert.throws(() => config({ EAS_BUILD_PLATFORM: platform, KAKAO_NATIVE_APP_KEY: key }), /KAKAO_NATIVE_APP_KEY/);
    }
  }
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
