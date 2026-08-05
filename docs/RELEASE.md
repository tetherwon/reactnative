# 스토어 릴리즈 절차 (플레이스토어 / App Store)

## 사전 준비 (최초 1회)

프로덕션 빌드에 필요한 EAS 환경변수. CLI 옵션이 버전마다 다르면
expo.dev → 프로젝트 → Environment variables 화면에서 만들어도 된다.

```bash
# AdMob 앱 ID — AdMob 콘솔 → 앱 → 앱 설정 (ca-app-pub-…~… 형식, ~ 포함)
eas env:create --environment production --name ADMOB_ANDROID_APP_ID \
  --value "ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY" --visibility sensitive

# Firebase 설정 파일 — Firebase 콘솔 → 프로젝트 설정 → Android 앱
# (package: store.shoppinglog.app) 에서 google-services.json 다운로드
eas env:create --environment production --name GOOGLE_SERVICES_JSON \
  --type file --value ./google-services.json --visibility secret

# 애드팝콘 오퍼월 매체 키 · 해시 키 — AdPopcorn 파트너스 대시보드에서 발급.
# EXPO_PUBLIC_ 접두사 필수(Metro가 JS 번들에 그대로 인라인해야 iOS에서
# setAppKey()가 동작). 어차피 APK/IPA 안에 평문으로 들어가는 값이라(Android는
# AndroidManifest.xml meta-data라 apktool로 누구나 추출 가능) plaintext로 등록.
eas env:create --environment production --name EXPO_PUBLIC_ADPOPCORN_APP_KEY \
  --value "매체 키" --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_ADPOPCORN_HASH_KEY \
  --value "해시 키" --visibility plaintext
```

- **`ADMOB_ANDROID_APP_ID`는 production 빌드 필수.** GMA SDK는 매니페스트에
  유효한 앱 ID가 없으면 광고를 안 불러도 앱 시작 시 "Invalid application ID"
  크래시를 낸다 — 실제로 이 크래시로 플레이 심사에서 거절당했다("손상된 기능
  정책: 설치되지만 로드되지 않음"). 그래서 app.config.js에 안드로이드 앱 ID를
  직접 박아뒀다(환경변수로 덮어쓰기 가능) — 환경변수를 깜빡해도 크래시하지 않는다.
- `GOOGLE_SERVICES_JSON`은 없어도 빌드·실행은 되지만 네이티브 푸시가 비활성.
- `EXPO_PUBLIC_ADPOPCORN_APP_KEY`/`HASH_KEY`가 없어도 빌드는 되지만 오퍼월
  카드가 열리지 않는다(AdMob과 달리 크래시는 없음). 서버 쪽 포스트백 검증용
  `ADPOPCORN_HASH_KEY`(Railway env, Shopping_log 레포)에도 **같은 해시 키**를
  넣어야 리워드 지급이 통과한다.
- 카카오 로그인용 `KAKAO_NATIVE_APP_KEY`는 기존에 설정돼 있음.

AdMob 앱 ID 얻는 곳: AdMob 콘솔(admob.google.com) → 앱 → 쇼핑로그(안드로이드,
package `store.shoppinglog.app`가 등록돼 있어야 함) → 앱 설정 → "앱 ID"
(`ca-app-pub-…~…` 형식, 광고 단위 ID와 다르다 — `~`가 들어간 쪽이 앱 ID).

## iOS 추가 준비 (최초 1회)

```bash
# iOS 전용 AdMob 앱 ID — 안드로이드 앱 ID를 그대로 쓰면 안 된다.
# AdMob 콘솔 → 앱 추가 → iOS → 번들 ID store.shoppinglog.app
# (~접미사가 안드로이드와 다른 새 ID가 나온다)
eas env:create --environment production --name ADMOB_IOS_APP_ID \
  --value "ca-app-pub-XXXXXXXXXXXXXXXX~ZZZZZZZZZZ" --visibility sensitive
```

- **`ADMOB_IOS_APP_ID` 없이는 iOS 빌드가 시작 단계에서 실패한다**
  (app.config.js가 `EAS_BUILD_PLATFORM=ios` 일 때 명시적으로 에러를 던진다).
  안드로이드 앱 ID가 실수로 IPA에 들어가면 `GADApplicationIdentifier` 가
  번들과 매칭되지 않아 광고가 채워지지 않고 AdMob 계정이 제재될 수 있다.
- **ATT(App Tracking Transparency)**: 광고 SDK가 IDFA 권한을 요청하는데
  `NSUserTrackingUsageDescription` 이 Info.plist 에 없으면 iOS가 앱을 즉시
  종료시킨다. app.config.js의 `userTrackingUsageDescription` 으로 주입된다.
- **APNs 키**: iOS 원격 푸시는 FCM이 아니라 APNs다. `eas credentials` 로 APNs
  키를 등록해야 `getExpoPushTokenAsync()` 가 토큰을 돌려준다. 미등록이어도
  빌드·실행은 되지만 푸시가 안 온다(코드가 조용히 null 처리).
- **SKAdNetwork**: 광고 기여도 측정을 하려면 Google이 공개한 SKAdNetwork ID
  목록을 app.config.js의 `skAdNetworkItems` 에 넣어야 한다. 없어도 크래시는
  없고 기여도 측정만 빠진다.
- **App Store 심사**: 웹뷰 셸이라 4.2(Minimum Functionality) 지적을 받을 수
  있다. 네이티브 기능(앱 잠금·푸시·햅틱·오프라인 화면)을 심사 노트에 적어둘 것.
  심사원이 비행기모드로 켜보므로 ConnectionErrorView 동작을 먼저 확인한다.

## 빌드 & 업로드 (매번)

```bash
git checkout main && git pull origin main
npm ci

# AAB 빌드 — production 프로필 = app-bundle + versionCode 자동 증가
eas build --platform android --profile production

# 업로드: 플레이 콘솔에 AAB 수동 업로드, 또는 서비스 계정이 연결돼 있으면
eas submit --platform android --latest

# iOS — IPA 빌드 후 App Store Connect 업로드
eas build --platform ios --profile production
eas submit --platform ios --latest
```

> `npm ci` 는 package.json 과 package-lock.json 이 어긋나면 즉시 실패한다
> (EAS 빌드도 `npm ci` 를 쓴다). 의존성을 추가했다면 **package-lock.json 도 반드시
> 같이 커밋**할 것 — `npm install --package-lock-only` 로 갱신할 수 있다.

## 릴리즈 후 확인

1. 새 빌드 설치 → 로그인 → 충전소 진입 → 광고 카드의 '준비중' 배지가
   사라졌는지 확인
2. 광고 시청 → 수 초 내 잔액 +1캐시 (Google SSV 콜백 경유,
   Shopping_log `docs/RN_BRIDGE.md` 참고)
3. 알림 권한 허용 → 서버에서 푸시 발송 → 수신·탭 이동 확인
4. (관리자 계정) 충전소 진입 → 오퍼월 카드 열기 → 캠페인 목록이 뜨는지,
   닫았을 때 잔액이 갱신되는지 확인. 실제 리워드 지급은 애드팝콘이 보내는
   포스트백(`/api/adpopcorn/postback`)이 처리하므로 캠페인 완료까지 해봐야
   확인 가능 — Railway 로그에서 `adpopcorn` 검색

## 오퍼월이 안 열릴 때 (안드로이드)

애드팝콘은 실패해도 크래시를 내지 않고 "눌러도 아무 반응 없음"이 된다.
네이티브 모듈이 단계마다 로그를 찍으므로 실기기를 USB로 연결해 확인한다.

```bash
adb logcat -c && adb logcat | grep -Ei "RNAdPopcornRewardModule|adpopcorn|igaworks"
```

- **`openOfferwall` 로그조차 안 뜬다** → JS 가 네이티브까지 못 갔다.
  웹이 보낸 `userId` 가 비었거나(문자열/숫자 아님), 이 바이너리에 SDK 가 없다.
- **`openOfferwall` 은 뜨는데 화면이 안 뜬다** → 네이티브 SDK 단계 문제.
  대부분 **앱키 미설정**이다. 아래로 확인한다:

```bash
# 설치된 APK 의 매니페스트에 키가 실제로 박혔는지 (빈 값이면 이게 원인)
adb shell dumpsys package store.shoppinglog.app | grep -i adpopcorn
```

키가 비어 있다면 `EXPO_PUBLIC_ADPOPCORN_APP_KEY` / `HASH_KEY` 가 빌드에
주입되지 않은 것이다. 순서대로 확인:

1. `eas env:list --environment production` — 값이 등록돼 있는가
2. `eas.json` 의 `build.<프로필>.environment` 가 그 environment 와 같은가
   (**이 필드가 없으면 EAS 가 환경변수를 안 넣어줄 수 있다** — AdMob 앱 ID를
   app.config.js 에 직접 박게 된 것도 같은 이유였다)
3. 빌드 로그에 `⚠️ EXPO_PUBLIC_ADPOPCORN_APP_KEY / HASH_KEY 가 비어 있습니다`
   경고가 있는지 (app.config.js 가 빌드 시 찍는다)

`adb` 없이 보려면 EAS 빌드 로그의 "Run expo prebuild" 단계에서 위 경고를 찾는다.

## 버전/OTA 규칙

- `runtimeVersion.policy: appVersion` — OTA(JS) 업데이트는 **같은
  app.config.js `version`으로 빌드된 바이너리에만** 배포된다.
- main 푸시 → GitHub Actions가 자동으로 `eas update --branch production`
  실행 (JS/이미지 변경만 OTA로 나감).
- **`eas update` 에도 `--environment production` 이 필요하다.** `EXPO_PUBLIC_*`
  값은 Metro 가 번들에 인라인하므로, 환경변수 없이 OTA 를 내보내면 그 값을 쓰는
  코드(iOS 애드팝콘 `setAppKey`)가 빈 문자열을 받아 조용히 멈춘다. 워크플로에
  이미 반영돼 있으니 수동으로 `eas update` 를 돌릴 때도 빼먹지 말 것.
- **네이티브 변경(새 패키지, app.config.js의 plugins/android/ios 수정) 시엔
  반드시 `version`을 올리고 새로 빌드해서 스토어에 올려야 한다.**
  버전을 안 올리면 네이티브 모듈이 없는 기존 바이너리가 새 JS를 OTA로
  받아 크래시할 수 있다.
