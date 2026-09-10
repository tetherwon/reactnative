const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
function load(name, mocks) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/', name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(js, { exports, require: p => mocks[p], setTimeout, clearTimeout });
  return exports;
}
const bridge = () => load('kakaoBridge', { './externalLinks': { APP_ORIGIN: 'https://shoppinglog.store' } });

test('bridge is idempotent, rejects duplicates and ignores another document response', async () => {
  const b = bridge();
  function page() {
    const messages = [];
    const window = { ReactNativeWebView: { postMessage: v => messages.push(JSON.parse(v)) } };
    const ctx = vm.createContext({ window, location: { origin: 'https://shoppinglog.store' }, setTimeout, clearTimeout });
    vm.runInContext(b.KAKAO_BRIDGE_INJECTED_JS, ctx);
    return { window, messages, ctx };
  }
  const a = page();
  const login = a.window.Capacitor.Plugins.KakaoAuth.login();
  vm.runInContext(b.KAKAO_BRIDGE_INJECTED_JS, a.ctx);
  await assert.rejects(a.window.Capacitor.Plugins.KakaoAuth.login(), /login_busy/);
  const other = page();
  const second = other.window.Capacitor.Plugins.KakaoAuth.login();
  assert.notEqual(a.messages[0].id, other.messages[0].id);
  vm.runInContext(b.resolveKakaoLoginScript(a.messages[0].id, 'wrong-page'), other.ctx);
  vm.runInContext(b.resolveKakaoLoginScript(a.messages[0].id, 'token-a'), a.ctx);
  vm.runInContext(b.resolveKakaoLoginScript(other.messages[0].id, 'token-b'), other.ctx);
  assert.equal((await login).accessToken, 'token-a');
  assert.equal((await second).accessToken, 'token-b');
});

test('untrusted origin cannot install a native bridge', () => {
  const window = {};
  vm.runInNewContext(bridge().KAKAO_BRIDGE_INJECTED_JS, { window, location: { origin: 'https://example.com' } });
  assert.equal(window.Capacitor, undefined);
});

test('concurrent requests launch SDK once through the prompt queue, cancellation permits retry', async () => {
  let calls = 0, queued = 0;
  const mod = load('kakaoLogin', {
    '@react-native-seoul/kakao-login': { login: async () => { calls++; if (calls === 1) throw Error('user cancelled'); return { accessToken: 'ok' }; } },
    './nativePrompts': { withNativePrompt: fn => { queued++; return Promise.resolve().then(fn); } },
  });
  const a = mod.loginWithKakao(); const b = mod.loginWithKakao();
  assert.equal(a, b);
  await assert.rejects(a, /cancelled/);
  assert.equal(calls, 1); assert.equal(queued, 1);
  assert.equal(await mod.loginWithKakao(), 'ok');
});
