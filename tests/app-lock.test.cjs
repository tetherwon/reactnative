const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the component's real effects with native APIs mocked. This checks the
// lock policy and mount behavior; it does not emulate Face ID or a real WebView.
function mountGate({ os = 'ios', result = { success: true }, hardwareError = false,
  enrolled = true, tracking = async () => false } = {}) {
  const effects = [], cleanups = [], states = [], refs = [];
  const calls = { hardware: 0, authenticate: 0 };
  let stateIndex = 0, refIndex = 0, firstRender = true;
  const react = {
    useState(initial) {
      const index = stateIndex++;
      if (firstRender) states[index] = initial;
      return [states[index], value => { states[index] = value; }];
    },
    useRef(current) {
      const index = refIndex++;
      if (firstRender) refs[index] = { current };
      return refs[index];
    },
    useCallback: fn => fn,
    useEffect: fn => { if (firstRender) effects.push(fn); },
  };
  const jsx = (type, props) => ({ type, props });
  const mocks = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': {
      Platform: { OS: os }, AppState: { addEventListener: () => ({ remove() {} }) },
      StyleSheet: { create: value => value, absoluteFill: {} },
      View: 'View', Text: 'Text', Pressable: 'Pressable',
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-local-authentication': {
      hasHardwareAsync: async () => {
        calls.hardware++;
        if (hardwareError) throw Error('hardware unavailable');
        return true;
      },
      isEnrolledAsync: async () => enrolled,
      authenticateAsync: async () => { calls.authenticate++; return result; },
    },
    '@/lib/haptics': { success() {}, tap() {} },
    '@/lib/tracking': { ensureTrackingPermission: tracking },
    '@/lib/nativePrompts': { withNativePrompt: async action => action() },
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(
    path.join(__dirname, '../src/components/AppLockGate.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    assert.ok(name in mocks, 'unexpected dependency: ' + name);
    return mocks[name];
  } });
  const guest = { type: 'WebView', props: { session: null } };
  function render() {
    stateIndex = 0; refIndex = 0;
    const tree = exports.default({ children: guest });
    firstRender = false;
    return tree;
  }
  const initial = render();
  effects.forEach(effect => cleanups.push(effect()));
  return { guest, initial, calls, render,
    settle: () => new Promise(setImmediate),
    cleanup: () => cleanups.forEach(cleanup => cleanup?.()),
  };
}

test('Android guest mounts immediately without biometric capability queries or prompts', async () => {
  const app = mountGate({ os: 'android' });
  try {
    assert.equal(app.initial.props.children[0], app.guest);
    assert.equal(app.initial.props.children[1], false);
    await app.settle();
    assert.deepEqual(app.calls, { hardware: 0, authenticate: 0 });
    assert.equal(app.render().props.children[1], false);
  } finally { app.cleanup(); }
});

test('current iOS policy keeps a guest WebView mounted but covered after biometric cancellation', async () => {
  const app = mountGate({ result: { success: false, error: 'user_cancel' } });
  try {
    assert.equal(app.initial.props.children[0], app.guest);
    await app.settle();
    const tree = app.render();
    assert.equal(tree.props.children[0], app.guest);
    assert.equal(tree.props.children[1].type, 'SafeAreaView');
    const retry = tree.props.children[1].props.children.props.children[2];
    assert.equal(retry.type, 'Pressable');
    assert.equal(retry.props.accessibilityLabel, '잠금 해제');
    assert.equal(app.calls.authenticate, 1);
  } finally { app.cleanup(); }
});

test('iOS authentication success uncovers the already mounted guest WebView', async () => {
  const app = mountGate();
  try {
    await app.settle();
    assert.equal(app.render().props.children[0], app.guest);
    assert.equal(app.render().props.children[1], false);
    assert.equal(app.calls.authenticate, 1);
  } finally { app.cleanup(); }
});

test('iOS capability query failure or no enrollment does not strand the guest at checking', async () => {
  for (const options of [{ hardwareError: true }, { enrolled: false }]) {
    const app = mountGate(options);
    try {
      await app.settle();
      assert.equal(app.render().props.children[1], false);
      assert.equal(app.calls.authenticate, 0);
    } finally { app.cleanup(); }
  }
});

test('pending ATT postpones biometrics; after ATT completes the guest can unlock', async () => {
  let finishTracking;
  const pending = new Promise(resolve => { finishTracking = resolve; });
  const app = mountGate({ tracking: () => pending });
  try {
    await app.settle();
    assert.equal(app.calls.authenticate, 0);
    assert.equal(app.render().props.children[1].type, 'SafeAreaView');
    finishTracking(false);
    await app.settle();
    assert.equal(app.calls.authenticate, 1);
    assert.equal(app.render().props.children[1], false);
  } finally { app.cleanup(); }
});
