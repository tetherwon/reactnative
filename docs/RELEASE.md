# 스토어 릴리즈 절차

안드로이드(플레이스토어)와 iOS(앱스토어) 절차를 나눠 적는다.
맨 아래 "버전/OTA 규칙"은 두 플랫폼 공통이다.

# Android — 플레이스토어

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
  정책: 설치되지만 로드되지 않음"). 그래서 app.config.js가 production 빌드에서
  앱 ID가 없으면 빌드를 실패시킨다. 개발/프리뷰 빌드는 Google 공식 샘플 앱
  ID로 대체돼 크래시 없이 동작한다(실광고는 안 나옴).
- `GOOGLE_SERVICES_JSON`은 없어도 빌드·실행은 되지만 네이티브 푸시가 비활성.
- `EXPO_PUBLIC_ADPOPCORN_APP_KEY`/`HASH_KEY`가 없어도 빌드는 되지만 오퍼월
  카드가 열리지 않는다(AdMob과 달리 크래시는 없음). 서버 쪽 포스트백 검증용
  `ADPOPCORN_HASH_KEY`(Railway env, Shopping_log 레포)에도 **같은 해시 키**를
  넣어야 리워드 지급이 통과한다.
- 카카오 로그인용 `KAKAO_NATIVE_APP_KEY`는 기존에 설정돼 있음.

AdMob 앱 ID 얻는 곳: AdMob 콘솔(admob.google.com) → 앱 → 쇼핑로그(안드로이드,
package `store.shoppinglog.app`가 등록돼 있어야 함) → 앱 설정 → "앱 ID"
(`ca-app-pub-…~…` 형식, 광고 단위 ID와 다르다 — `~`가 들어간 쪽이 앱 ID).

## 빌드 & 업로드 (매번)

```bash
git checkout main && git pull origin main
npm ci

# AAB 빌드 — production 프로필 = app-bundle + versionCode 자동 증가
eas build --platform android --profile production

# 업로드: 플레이 콘솔에 AAB 수동 업로드, 또는 서비스 계정이 연결돼 있으면
eas submit --platform android --latest
```

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

# iOS — 앱스토어

## 사전 준비 (최초 1회)

**1) Apple Developer Program 가입** (연 $99). 승인에 1~2일 걸린다. 이게 없으면
실기기 빌드·TestFlight·심사 제출이 전부 불가능하다.

**2) EAS 환경변수** — 안드로이드와 같은 `production` 환경을 쓴다. iOS 빌드에서
새로 등록해야 하는 값은 없지만, 아래 두 개가 **iOS에도 필요하다**:

- `KAKAO_NATIVE_APP_KEY` — 없으면 app.config.js가 EAS 빌드를 즉시 실패시킨다.
- `EXPO_PUBLIC_ADPOPCORN_APP_KEY` / `_HASH_KEY` — iOS는 Metro가 이 값을 JS
  번들에 인라인해 `src/lib/adpopcorn.ts`의 `setAppKey()`가 직접 읽는다
  (안드로이드처럼 매니페스트 주입이 아니다). 비면 오퍼월이 안 열린다.

AdMob iOS 앱 ID(`ca-app-pub-1856287061134936~6447506732`)는 app.config.js에
기본값으로 박혀 있어 별도 등록이 필요 없다. 안드로이드 ID와 같아지면
빌드가 실패하도록 가드가 걸려 있다(번들 ID 불일치 → 광고 전량 로드 실패 방지).

`GOOGLE_SERVICES_JSON`은 **안드로이드 전용**이다. iOS 푸시는 APNs를 쓰므로
이 파일과 무관하다.

**3) 서버(Railway, Shopping_log 레포)에 iOS 광고 단위 ID 등록**

```
ADMOB_REWARDED_AD_UNIT_ID_IOS
ADMOB_BANNER_AD_UNIT_ID_IOS
```

AdMob 광고 단위는 플랫폼마다 다르다. `/api/app-config?platform=ios`가 이 값만
보고, 없으면 **폴백 없이 기능을 끈다**(로드될 리 없는 광고를 계속 요청하지
않도록). 등록을 빼먹으면 iOS에서 '광고 보고 적립'이 영영 준비중으로 남는다.

**4) App Store Connect에 앱 레코드 생성** — 업로드보다 **먼저** 해야 한다.
앱 레코드가 없으면 `eas submit`이 실패한다.

appstoreconnect.apple.com → 앱 → **+** → 신규 앱:
- 플랫폼: iOS
- 번들 ID: **`store.shoppinglog.app`**
- SKU: 아무 문자열이면 된다 (`shoppinglog`)

서명 인증서·프로비저닝 프로파일은 EAS가 자동으로 만들어 관리하므로 직접
준비할 것이 없다. 첫 빌드에서 Apple 계정 로그인만 물어본다.

## 빌드 & 업로드 (매번)

```bash
git checkout main && git pull origin main
npm ci

# IPA 빌드 — production 프로필 = buildNumber 자동 증가 (appVersionSource: remote)
eas build --platform ios --profile production

# App Store Connect 업로드
eas submit --platform ios --latest
```

- 빌드는 15~30분 걸린다.
- `eas.json`의 `submit.production`이 비어 있어 Apple ID·대상 앱을 대화형으로
  물어본다. 앱 암호(app-specific password)를 요구하면 appleid.apple.com →
  로그인 및 보안 → 앱 암호에서 발급한다.
- 업로드 후 애플이 바이너리를 처리하는 데 **10~30분**. 그 전에는 TestFlight에
  빌드가 보이지 않는다(업로드 실패가 아니다).

## 심사 제출 전 체크리스트

빌드가 올라가도 아래가 안 채워지면 제출 버튼이 활성화되지 않는다.

| 항목 | 상태 |
|------|------|
| 수출 규정 (`ITSAppUsesNonExemptEncryption: false`) | app.config.js에 있음 — 자동 통과 |
| ATT 문구 + 실제 권한 요청 | 문구·요청 코드 모두 있음 (1.3.3~) |
| SKAdNetwork 식별자 | app.config.js에서 주입 (1.3.3~) |
| 카메라·사진 권한 문구 | app.config.js에 있음 |
| 개인정보 처리방침 URL | `https://shoppinglog.store/privacy` |
| **앱 개인정보 보호**(데이터 수집 신고) | 콘솔에서 직접 입력 — 아래 참고 |
| 스크린샷 (6.9" 또는 6.7" 아이폰) | 직접 준비 |
| iPad 스크린샷 | **불필요** — `supportsTablet: false` |
| 회원 탈퇴 경로 (5.1.1(v)) | 네이티브 프로필 → `/account-deletion` |
| Sign in with Apple (4.8) | 구현됨 |

**앱 개인정보 보호가 가장 많이 걸리는 항목이다.** AdMob·애드팝콘이 IDFA를
사용하므로 "데이터를 사용하여 사용자를 추적함"에 **식별자 → 기기 ID**를 반드시
체크한다. 실제 동작과 신고 내용이 다르면 거절된다.

⚠️ **이 신고와 ATT 프롬프트는 세트다.** 추적을 신고했는데 앱이 ATT 권한을
요청하지 않으면 5.1.2로 거절된다. 1.3.3부터 `src/lib/tracking.ts`가 광고·오퍼월
진입 직전에 요청하므로 신고해도 된다. **광고 관련 코드를 건드릴 때 이 요청
경로를 지우지 말 것** — 지우면 신고와 어긋나 다음 심사에서 걸린다.

콜드스타트가 아니라 광고를 쓰기 직전에 요청하는 이유: 앱 시작 시점에는
`AppLockGate`가 Face ID 프롬프트를 띄워서, 시스템 다이얼로그가 겹치면 한쪽이
조용히 무시된다.

`supportsTablet: false`인 이유: 콘텐츠가 max-width 640px 모바일 웹이라 iPad
전체 화면에서는 양옆이 크게 비어 가이드라인 4.2(Minimum Functionality)로
거절되기 쉽다. false면 iPad에서 아이폰 호환 모드로 실행돼 레이아웃이 깨지지
않고 심사 대상 기기도 아이폰으로 좁혀진다. 태블릿 레이아웃을 실제로 대응하게
되면 true로 되돌린다.

## 릴리즈 후 확인 (TestFlight)

1. **앱 잠금(`AppLockGate`) 부터 확인한다.** iOS 전용 경로라 실기기 검증
   이력이 없고, 앱 전체를 감싸고 있어 여기서 막히면 잠금 화면에서 아무 데도
   갈 수 없다. 설치 직후 가장 먼저 볼 것.
2. 카카오 로그인 — 카카오톡이 뜨는지(앱투앱). 아이디/비번 화면으로 빠지면
   `KAKAO_NATIVE_APP_KEY` 누락이거나 콘솔 번들 ID 미등록이다.
3. 캐시백 버튼 → 외부 쇼핑몰이 **시스템 브라우저**로 열리는지
   (웹뷰 안에서 열리면 전환 추적이 깨진다).
4. 결제·본인인증 앱 전환 — `LSApplicationQueriesSchemes`에 등록한 스킴이
   실제로 동작하는지. 아무 반응이 없으면 스킴 누락이다.
5. 충전소 → 리워드 광고 로드 및 시청 후 잔액 증가, 오퍼월 카드 열림.
6. 화면 엣지 스와이프 뒤로가기.

# 버전/OTA 규칙 (공통)

- `runtimeVersion.policy: appVersion` — OTA(JS) 업데이트는 **같은
  app.config.js `version`으로 빌드된 바이너리에만** 배포된다.
- main 푸시 → GitHub Actions가 자동으로 `eas update --branch production`
  실행 (JS/이미지 변경만 OTA로 나감).
- **네이티브 변경(새 패키지, app.config.js의 plugins/android/ios 수정) 시엔
  반드시 `version`을 올리고 새로 빌드해서 스토어에 올려야 한다.**
  버전을 안 올리면 네이티브 모듈이 없는 기존 바이너리가 새 JS를 OTA로
  받아 크래시할 수 있다.
- 안드로이드·iOS는 `version`을 공유한다. 한쪽만 네이티브 변경이 있어도
  version을 올리면 양쪽 다 새 빌드가 필요해진다(OTA 대상이 갈리므로).
