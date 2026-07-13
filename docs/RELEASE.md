# 플레이스토어 릴리즈 절차

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
```

- 둘 다 없어도 빌드는 성공한다. 대신 `ADMOB_ANDROID_APP_ID` 없으면 보상형
  광고(충전소 광고 카드)가, `GOOGLE_SERVICES_JSON` 없으면 네이티브 푸시가
  비활성 상태로 빌드된다. (app.config.js가 조건부로 플러그인을 뺀다)
- 카카오 로그인용 `KAKAO_NATIVE_APP_KEY`는 기존에 설정돼 있음.

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

## 버전/OTA 규칙

- `runtimeVersion.policy: appVersion` — OTA(JS) 업데이트는 **같은
  app.config.js `version`으로 빌드된 바이너리에만** 배포된다.
- main 푸시 → GitHub Actions가 자동으로 `eas update --branch production`
  실행 (JS/이미지 변경만 OTA로 나감).
- **네이티브 변경(새 패키지, app.config.js의 plugins/android/ios 수정) 시엔
  반드시 `version`을 올리고 새로 빌드해서 스토어에 올려야 한다.**
  버전을 안 올리면 네이티브 모듈이 없는 기존 바이너리가 새 JS를 OTA로
  받아 크래시할 수 있다.
