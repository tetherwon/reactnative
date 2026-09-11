const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

function mountScreen() {
  const slots = [];
  const effects = [];
  const timers = new Map();
  let timerId = 0;
  let mounted = false;
  let cleanups = [];
  let cursor = 0;
  let authLoaded;
  let authUrl;
  let flushes = 0;
  let goTo;
  const scripts = [];
  const react = {
    useRef: initial => slots[cursor++] ||= { current: initial },
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useCallback: fn => fn,
    useEffect(fn) { if (!mounted) effects.push(fn); },
  };
  const mocks = {
    react,
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-native': { Platform: { OS: 'android' }, BackHandler: { addEventListener: () => ({ remove() {} }) }, View: 'View', StyleSheet: { create: x => x } },
    '@react-native-community/netinfo': { useNetInfo: () => ({ isConnected: true }) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'react-native-webview': { WebView: 'WebView' },
    '@/components/ConnectionErrorView': { __esModule: true, default: 'ConnectionErrorView' },
    '@/components/WebViewSplash': { __esModule: true, default: 'WebViewSplash' },
    '@/hooks/useWebViewAuth': { useWebViewAuth: (ref, loaded, currentUrl) => {
      authUrl = currentUrl;
      authLoaded = loaded;
      ref.current = { injectJavaScript: script => scripts.push(script), reload() {} };
      return { openNativeOAuth() {}, flushPendingAuth() { flushes++; } };
    } },
    '@/hooks/useNativeBridge': { useNativeBridge: (ref, navigate) => { goTo = navigate; return { onMessage() {} }; } },
    '@/lib/externalLinks': { APP_ORIGIN: 'https://shoppinglog.store', resolveNavigationTarget: u => 'https://shoppinglog.store' + u },
    '@/lib/haptics': { error() {} },
    '@/lib/kakaoBridge': {},
  };
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/index.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, { exports, setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id), require: p => { if (!(p in mocks)) throw Error(p); return mocks[p]; } });
  const render = () => { cursor = 0; const tree = exports.default(); if (!mounted) { mounted = true; cleanups = effects.map(fn => fn()); } return tree; };
  const find = (node, type) => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === type) return node;
    for (const child of [node.props?.children].flat()) { const found = find(child, type); if (found) return found; }
    return null;
  };
  return { render, find, timers, expire() { for (const timer of [...timers.values()]) timer.fn(); }, unmount() { cleanups.forEach(fn => fn?.()); }, get currentUrl() { return authUrl.current; }, get loaded() { return authLoaded.current; }, get flushes() { return flushes; }, navigate: u => goTo(u), scripts };
}

test('logged-out cold start renders WebView without waiting for an auth token', () => {
  const app = mountScreen();
  const tree = app.render();
  const web = app.find(tree, 'WebView');
  assert.equal(web.props.source.uri, 'https://shoppinglog.store');
  assert.ok(app.find(tree, 'WebViewSplash'));
  web.props.onLoadEnd();
  assert.equal(app.loaded, true);
  assert.equal(app.find(app.render(), 'WebViewSplash'), null);
  assert.equal(app.scripts.length, 0);
});

test('failed loads retain pending navigation and later successful loads dismiss the error overlay', () => {
  const app = mountScreen();
  const web = app.find(app.render(), 'WebView');
  web.props.onError();
  web.props.onLoadEnd();
  assert.equal(app.loaded, false);
  assert.equal(app.flushes, 0);
  assert.ok(app.find(app.render(), 'ConnectionErrorView'));
  app.navigate('/mypage');
  assert.equal(app.scripts.length, 0, 'do not inject into an error document');
  web.props.onLoadStart();
  web.props.onLoadEnd();
  assert.equal(app.loaded, true);
  assert.equal(app.flushes, 1);
  assert.equal(app.scripts.length, 1);
  assert.equal(app.find(app.render(), 'ConnectionErrorView'), null);
  web.props.onLoadStart();
  assert.equal(app.loaded, false, 'every document navigation invalidates readiness');
});


test('silent cold start times out, retry remounts, and late load-end cannot hide failure', () => {
  const app = mountScreen();
  const initial = app.find(app.render(), 'WebView');
  assert.equal(app.timers.size, 1);
  assert.equal([...app.timers.values()][0].ms, 30_000);
  initial.props.onNavigationStateChange({ url: 'https://accounts.google.com', canGoBack: true });
  app.expire();
  initial.props.onLoadEnd();
  assert.equal(app.loaded, false);
  const error = app.find(app.render(), 'ConnectionErrorView');
  assert.ok(error);
  error.props.onRetry();
  const retry = app.find(app.render(), 'WebView');
  assert.notEqual(retry.key, initial.key);
  assert.equal(app.currentUrl, 'https://shoppinglog.store');
  assert.equal(app.timers.size, 1);
  retry.props.onLoadStart();
  retry.props.onLoadEnd();
  assert.equal(app.timers.size, 0);
  assert.equal(app.find(app.render(), 'ConnectionErrorView'), null);
  retry.props.onLoadStart();
  app.unmount();
  assert.equal(app.timers.size, 0);
});

for (const event of ['onHttpError', 'onRenderProcessGone', 'onContentProcessDidTerminate']) {
  test(event + ' exposes a retry that replaces the failed WebView', () => {
    const app = mountScreen();
    const web = app.find(app.render(), 'WebView');
    web.props.onLoadEnd();
    web.props[event]({ nativeEvent: { statusCode: 503, didCrash: true } });
    assert.equal(app.loaded, false);
    assert.equal(app.timers.size, 0);
    const error = app.find(app.render(), 'ConnectionErrorView');
    assert.ok(error);
    error.props.onRetry();
    assert.notEqual(app.find(app.render(), 'WebView').key, web.key);
  });
}
