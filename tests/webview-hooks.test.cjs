const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

function mount(name, mocks) {
  const effects = [];
  const exports = {};
  const react = { useRef: current => ({ current }), useCallback: fn => fn, useEffect: fn => effects.push(fn) };
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/hooks', name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(js, { exports, URL, require: p => p === 'react' ? react : mocks[p] });
  return { hook: exports[name], effects };
}

test('cold-start auth waits for load and returns to own origin before injecting once', async () => {
  const scripts = [];
  const loaded = { current: false };
  const currentUrl = { current: 'https://shoppinglog.store' };
  const app = mount('useWebViewAuth', {
    'expo-router': { useLocalSearchParams: () => ({ code: 'code', state: 'state' }) },
    'expo-web-browser': {}, 'react-native': { Alert: { alert() {} } },
    '@/lib/authGate': { exchangeOAuthCode: async () => 'session-token' },
    '@/lib/externalLinks': { APP_ORIGIN: 'https://shoppinglog.store', isAppOrigin: u => new URL(u).origin === 'https://shoppinglog.store' },
  });
  const auth = app.hook({ current: { injectJavaScript: js => scripts.push(js) } }, loaded, currentUrl);
  app.effects.forEach(fn => fn());
  await new Promise(setImmediate);
  assert.equal(scripts.length, 0);
  loaded.current = true;
  currentUrl.current = 'https://accounts.google.com';
  auth.flushPendingAuth();
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].includes('session-token'), false);
  currentUrl.current = 'https://shoppinglog.store/';
  auth.flushPendingAuth(); auth.flushPendingAuth();
  assert.equal(scripts.length, 2);
  const saved = [];
  const location = { origin: 'https://shoppinglog.store' };
  vm.runInNewContext(scripts[1], { location, localStorage: { setItem: (...args) => saved.push(args) } });
  assert.deepEqual(saved, [['sl_token', 'session-token']]);
  assert.equal(location.href, '/');
});

test('native bridge keeps origin gate and numeric user IDs after extraction', async () => {
  const ads = [], scripts = [];
  const app = mount('useNativeBridge', {
    'react-native': {}, 'expo-notifications': { useLastNotificationResponse: () => null },
    '@/lib/admob': { showRewardedAd: async (...args) => { ads.push(args); return true; } },
    '@/lib/adpopcorn': {}, '@/lib/haptics': {}, '@/lib/kakaoLogin': {}, '@/lib/notifications': {},
    '@/lib/kakaoBridge': {},
    '@/lib/externalLinks': { APP_ORIGIN: 'https://shoppinglog.store', isAppOrigin: u => new URL(u).origin === 'https://shoppinglog.store' },
  });
  const { onMessage } = app.hook({ current: { injectJavaScript: js => scripts.push(js) } }, () => {});
  const data = JSON.stringify({ type: 'admob:showRewarded', adUnit: 'unit', userId: 123 });
  onMessage({ nativeEvent: { url: 'https://example.com', data } });
  assert.equal(ads.length, 0);
  onMessage({ nativeEvent: { url: 'https://shoppinglog.store', data } });
  await new Promise(setImmediate);
  assert.deepEqual(ads, [['unit', '123']]);
  assert.match(scripts[0], /location.origin/);
  assert.match(scripts[0], /onAdmobResult\(true\)/);
});
