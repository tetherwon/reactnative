/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/adpopcorn.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

function load(platform, env) {
  const calls = [];
  const exports = {};
  const sdk = { default: {
    setAppKey: (...args) => calls.push(['keys', ...args]),
    setUserId: id => calls.push(['user', id]),
    openOfferwall: () => calls.push(['open']),
  } };
  vm.runInNewContext(js, { exports, process: { env }, __DEV__: false,
    require: name => name === 'react-native'
      ? { Platform: { OS: platform }, NativeModules: { RNAdPopcornRewardModule: {} } }
      : sdk,
  });
  return { open: exports.openOfferwall, calls };
}

const android = { EXPO_PUBLIC_ADPOPCORN_APP_KEY: 'android-app', EXPO_PUBLIC_ADPOPCORN_HASH_KEY: 'android-hash' };
const ios = { EXPO_PUBLIC_ADPOPCORN_APP_KEY_IOS: 'ios-app', EXPO_PUBLIC_ADPOPCORN_HASH_KEY_IOS: 'ios-hash' };

test('iOS uses its own credentials once, never Android credentials', () => {
  const app = load('ios', { ...android, ...ios });
  assert.equal(app.open('7'), true);
  assert.equal(app.open('8'), true);
  assert.deepEqual(app.calls, [['keys', 'ios-app', 'ios-hash'], ['user', '7'], ['open'], ['user', '8'], ['open']]);
});

test('iOS missing either credential cannot fall back or open the SDK', () => {
  for (const env of [android, { ...android, EXPO_PUBLIC_ADPOPCORN_APP_KEY_IOS: 'ios-app' },
    { ...android, EXPO_PUBLIC_ADPOPCORN_HASH_KEY_IOS: 'ios-hash' }]) {
    const app = load('ios', env);
    assert.equal(app.open('7'), false);
    assert.deepEqual(app.calls, []);
  }
});

test('Android keeps manifest initialization and does not call iOS setAppKey', () => {
  const app = load('android', android);
  assert.equal(app.open('7'), true);
  assert.deepEqual(app.calls, [['user', '7'], ['open']]);
});

test('build config checks the target platforms keys and keeps Android manifest values', () => {
  const configSource = fs.readFileSync(path.join(__dirname, '../app.config.js'), 'utf8');
  for (const [platform, keys, warns] of [['ios', ios, false], ['ios', android, true], ['android', android, false]]) {
    const warnings = [];
    const module = { exports: {} };
    vm.runInNewContext(configSource, { module, require,
      process: { env: { EAS_BUILD_PLATFORM: platform, ADMOB_IOS_APP_ID: 'ios-admob', ...keys } },
      console: { warn: m => warnings.push(m) },
    });
    assert.equal(warnings.some(m => m.includes('애드팝콘')), warns);
    if (platform === 'android') {
      const plugin = module.exports.expo.plugins.find(p => Array.isArray(p) && p[0] === './plugins/withAdpopcorn');
      assert.deepEqual(JSON.parse(JSON.stringify(plugin[1])), { appKey: 'android-app', hashKey: 'android-hash' });
    }
  }
});
