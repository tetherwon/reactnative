# Native startup and bridge review (2026-09-11)

Scope: `app.config.js`, `package.json`, `plugins/withAdpopcorn.js`,
`plugins/withProguardOptimize.js`, `plugins/withOptimizedResourceShrinking.js`,
`src/hooks/useNativeBridge.ts`, `src/lib/notifications.ts`, `nativePrompts.ts`,
`tracking.ts`, `admob.ts`, `adpopcorn.ts`, `kakaoLogin.ts`, `kakaoBridge.ts`,
and `haptics.ts`. Installed Kakao and AdPopcorn native/package sources were
also inspected. App lock and screen navigation were reviewed separately.

## Findings and changes

- `useNativeBridge.ts`: `JSON.parse('null')` succeeded and the following
  `data.type` access threw. Added an object guard and regression cases for
  null, arrays, primitives and invalid JSON. The current web scripts send
  objects, so this is a confirmed crash path, not a confirmed explanation
  of the reported logged-out launch failure.
- `app.config.js`: EAS native builds accepted an empty Kakao app key.
  The installed Kakao package initializes its SDK in the native module's
  constructor, before the user clicks login. The iOS constructor also
  force-unwraps `KAKAO_APP_KEY` if the plist entry is missing. Added a
  build-time empty/whitespace key guard for Android and iOS EAS builds;
  retained local export support. The existing iOS AdMob missing-ID guard
  now also rejects whitespace. No runtime/native configuration changed
  for builds with valid environment values. Production CI previously
  showed these environment names present; this does not establish that
  the user's installed binary has missing keys.

## Remaining review observations

- SDK 56, RN 0.85 and React 19.2.3 match the versioned Expo reference:
  https://docs.expo.dev/versions/v56.0.0/ . No version mismatch found.
- Kakao's JS import only captures the native module and does not call
  login on import. The wrapper deduplicates concurrent requests, serializes
  system prompts and bounds the active login request to 120 seconds.
- Notification registration failures resolve to null. Notification/ATT
  permission requests run on guest startup too, but are not themselves
  awaited by WebView rendering. App lock may wait behind the shared prompt
  queue; its behavior requires separate screen/gate analysis.
- AdMob and AdPopcorn imports are guarded. AdMob creation/load exceptions
  can still reject despite its never-reject comment; this is an ad-click
  issue, not a guest launch path. No SDK rewrite was made.
- AdPopcorn registers one global close listener without cleanup; screen
  remount can retain an old WebView ref. This affects offerwall refresh
  after remount, not initial logged-out rendering.
- R8 plugins and keep rules were inspected; there is no device crash log
  identifying an optimized-away class. No speculative optimizer change.
- Haptics catches runtime errors. Kakao token responses preserve origin
  and per-document request checks.

## Verification limits

`node --test tests/native-config.test.cjs tests/webview-hooks.test.cjs`:
4 passed. Config tests isolate environment values and check absent and
whitespace keys, valid iOS, Android fallback and local export.

No physical iOS/Android launch or release native crash reproduction was
available in this review. A successful JS export or VM test does not prove
that the user's installed binary launches successfully.
