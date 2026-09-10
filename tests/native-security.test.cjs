const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');

function modules(mocks = {}, globals = {}) {
  const cache = {};
  function load(name) {
    if (name in mocks) return mocks[name];
    if (cache[name]) return cache[name];
    const exports = cache[name] = {};
    const filename = path.join(__dirname, '../src/lib/', name + '.ts');
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(code, {
      exports, URL, AbortController, Date, console, setTimeout, clearTimeout,
      require: dep => load(dep.startsWith('./') ? dep.slice(2) : dep), ...globals,
    });
    return exports;
  }
  return load;
}

function authApp(fetch = async () => ({ ok: true, json: async () => ({ token: 'session-token' }) })) {
  const store = new Map();
  const load = modules({
    'expo-secure-store': {
      setItemAsync: async (key, value) => store.set(key, value),
      getItemAsync: async key => store.get(key) || null,
      deleteItemAsync: async key => store.delete(key),
    },
    'expo-crypto': {
      getRandomBytesAsync: async n => crypto.randomBytes(n),
      CryptoDigestAlgorithm: { SHA256: 'sha256' }, CryptoEncoding: { BASE64: 'base64' },
      digestStringAsync: async (_, v) => crypto.createHash('sha256').update(v).digest('base64'),
    },
    'react-native': { Linking: {}, Platform: { OS: 'ios' } },
  }, { fetch });
  return { auth: load('authGate'), store, links: load('externalLinks') };
}
const code = 'a'.repeat(43);

test('OAuth uses per-attempt state and SHA-256 challenge, without putting verifier in URL', async () => {
  const { auth, store } = authApp();
  const start = await auth.beginOAuth('https://shoppinglog.store/auth/apple?agree=1');
  const url = new URL(start.url);
  const pending = JSON.parse([...store.values()][0]);
  assert.equal(url.searchParams.get('agree'), '1');
  assert.equal(url.searchParams.get('app'), '1');
  assert.equal(url.searchParams.get('app_state'), pending.state);
  assert.equal(url.searchParams.get('code_challenge'), crypto.createHash('sha256').update(pending.verifier).digest('base64url'));
  assert.equal(start.url.includes(pending.verifier), false);
});

test('mismatched state cannot exchange or consume the real pending login', async () => {
  let calls = 0;
  const { auth } = authApp(async () => { calls++; return { ok: true, json: async () => ({ token: 'ok' }) }; });
  const start = await auth.beginOAuth('https://shoppinglog.store/auth/google');
  assert.equal(await auth.exchangeOAuthCode(code, 'b'.repeat(64)), null);
  assert.equal(calls, 0);
  assert.equal(await auth.exchangeOAuthCode(code, start.state), 'ok');
  assert.equal(calls, 1);
});

test('duplicate session/router callbacks exchange only once; canceled attempts are rejected', async () => {
  let calls = 0;
  const { auth } = authApp(async () => { calls++; return { ok: true, json: async () => ({ token: 'ok' }) }; });
  const start = await auth.beginOAuth('https://shoppinglog.store/auth/google');
  const result = await Promise.all([auth.exchangeOAuthCode(code, start.state), auth.exchangeOAuthCode(code, start.state)]);
  assert.deepEqual(result, ['ok', null]);
  assert.equal(calls, 1);
  const second = await auth.beginOAuth('https://shoppinglog.store/auth/apple');
  await auth.cancelOAuth(second.state);
  assert.equal(await auth.exchangeOAuthCode(code, second.state), null);
});

test('expired or future-dated login attempts never call the exchange endpoint', async () => {
  const { auth, store } = authApp(async () => { throw Error('must not fetch'); });
  for (const age of [600001, -10000]) {
    const start = await auth.beginOAuth('https://shoppinglog.store/auth/google');
    const key = [...store.keys()][0];
    const pending = JSON.parse(store.get(key)); pending.at = Date.now() - age;
    store.set(key, JSON.stringify(pending));
    assert.equal(await auth.exchangeOAuthCode(code, start.state), null);
  }
});

test('only exact first-party OAuth start paths are intercepted, never callbacks or other origins', () => {
  const { links } = authApp();
  for (const provider of ['google', 'apple', 'kakao']) assert.equal(links.isNativeOAuthStartUrl('https://shoppinglog.store/auth/' + provider), true);
  for (const url of ['https://shoppinglog.store/auth/google/callback?code=x', 'https://shoppinglog.store/auth/google-evil', 'https://shoppinglog.store:444/auth/google', 'https://shoppinglog.store.evil.com/auth/google']) {
    assert.equal(links.isNativeOAuthStartUrl(url), false);
  }
});

function promptApp(statuses = []) {
  let calls = 0;
  const appState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
  const load = modules({
    'react-native': { AppState: appState, Platform: { OS: 'ios' } },
    'expo-tracking-transparency': {
      getTrackingPermissionsAsync: async () => ({ status: 'undetermined' }),
      requestTrackingPermissionsAsync: async () => { calls++; return { status: statuses.shift() || 'granted' }; },
    },
  }, { setTimeout: fn => setImmediate(fn) });
  return { load, calls: () => calls, appState };
}

test('ATT requests are coalesced, undetermined results are retried on next call', async () => {
  const app = promptApp(['undetermined', 'undetermined', 'granted']);
  const tracking = app.load('tracking');
  const a = tracking.ensureTrackingPermission(), b = tracking.ensureTrackingPermission();
  assert.equal(a, b);
  assert.equal(await a, false);
  assert.equal(app.calls(), 2);
  assert.equal(await tracking.ensureTrackingPermission(), true);
  assert.equal(app.calls(), 3);
});

test('native system prompts never overlap, and a failed prompt does not block the queue', async () => {
  const { load } = promptApp();
  const { withNativePrompt } = load('nativePrompts');
  let active = 0, max = 0;
  const result = await Promise.allSettled([0, 1, 2].map(i => withNativePrompt(async () => {
    active++; max = Math.max(max, active);
    await new Promise(setImmediate); active--;
    if (i === 1) throw Error('permission interruption');
    return i;
  })));
  assert.equal(max, 1);
  assert.equal(result[2].status, 'fulfilled');
});

test('iOS returns Expo tokens and Android returns raw FCM tokens', async () => {
  for (const os of ['ios', 'android']) {
    let expoCalls = 0, deviceCalls = 0;
    const load = modules({
      'react-native': { Platform: { OS: os } },
      tracking: { ensureTrackingPermission: async () => false },
      nativePrompts: { withNativePrompt: async fn => fn() },
      'expo-constants': { __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'project-id' } } } } },
      'expo-device': { isDevice: true },
      'expo-notifications': {
        setNotificationHandler() {}, setNotificationChannelAsync: async () => {},
        AndroidImportance: { MAX: 5 }, IosAuthorizationStatus: { PROVISIONAL: 3 },
        getPermissionsAsync: async () => ({ status: 'granted', granted: true }),
        getDevicePushTokenAsync: async () => { deviceCalls++; return { data: 'fcm-device' }; },
        getExpoPushTokenAsync: async ({ projectId }) => { expoCalls++; assert.equal(projectId, 'project-id'); return { data: 'ExponentPushToken[ios-device]' }; },
      },
    });
    const result = await load('notifications').getNativePushTokenAsync();
    assert.equal(result.provider, os === 'ios' ? 'expo' : 'fcm');
    assert.equal(expoCalls, os === 'ios' ? 1 : 0);
    assert.equal(deviceCalls, os === 'android' ? 1 : 0);
  }
});
