const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(require('node:path').join(__dirname, '../src/lib/externalLinks.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const fallback = 'https://example.com/install';
const intent = 'intent://pay/order#Intent;scheme=testpay;package=com.test.pay;S.browser_fallback_url=' + encodeURIComponent(fallback) + ';end';

function load(successfulUrls, platform = 'android') {
  const attempts = [];
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: () => ({
      Platform: { OS: platform },
      Linking: {
        canOpenURL: async () => true,
        openURL: async url => {
          attempts.push(url);
          if (!successfulUrls.includes(url)) throw new Error('not installed');
        },
      },
    }),
  });
  return { open: exports.openExternalUrl, attempts };
}

test('installed intent handler wins over browser fallback', async () => {
  const app = load([intent, fallback]);
  await app.open(intent);
  assert.deepEqual(app.attempts, [intent]);
});

test('scheme deep link opens installed app when raw intent is unsupported', async () => {
  const app = load(['testpay://pay/order', fallback]);
  await app.open(intent);
  assert.deepEqual(app.attempts, [intent, 'testpay://pay/order']);
});

test('uninstalled app falls back to browser after both app attempts', async () => {
  const app = load([fallback]);
  await app.open(intent);
  assert.deepEqual(app.attempts, [intent, 'testpay://pay/order', fallback]);
});

test('broken fallback continues to market and web store', async () => {
  const app = load(['https://play.google.com/store/details?id=com.test.pay']);
  await app.open(intent);
  assert.deepEqual(app.attempts, [intent, 'testpay://pay/order', fallback,
    'market://details?id=com.test.pay', 'https://play.google.com/store/details?id=com.test.pay']);
});

test('malformed encoding and script fallback are not opened', async () => {
  for (const bad of ['%ZZ', encodeURIComponent('javascript:alert(1)')]) {
    const url = 'intent://pay#Intent;scheme=testpay;S.browser_fallback_url=' + bad + ';end';
    const app = load([]);
    await app.open(url);
    assert.deepEqual(app.attempts, [url, 'testpay://pay']);
  }
});

test('ordinary https and iOS app schemes still open directly', async () => {
  for (const [platform, url] of [['android', 'https://example.com'], ['ios', 'testpay://pay/order']]) {
    const app = load([url], platform);
    await app.open(url);
    assert.deepEqual(app.attempts, [url]);
  }
});
