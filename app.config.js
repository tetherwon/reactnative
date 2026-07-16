// 카카오 네이티브 앱 키는 퍼블릭 레포에 평문으로 남기지 않기 위해
// EAS 환경변수(KAKAO_NATIVE_APP_KEY)로 주입한다. (app.json 대신 app.config.js 사용 이유)
const KAKAO_NATIVE_APP_KEY = process.env.KAKAO_NATIVE_APP_KEY || '';

// AdMob 앱 ID (ca-app-pub-XXXX~YYYY, AdMob 콘솔 → 앱 설정).
// AdMob 앱 ID는 비밀값이 아니라 어차피 빌드된 앱에 그대로 박히는 공개값이므로
// 여기에 직접 등록한다(env로 덮어쓰기 가능). 이렇게 하면 EAS 환경변수를 깜빡
// 잊어 "Invalid application ID" 크래시로 심사 거절되던 위험이 원천 차단된다.
//
// ⚠️ iOS는 별도의 iOS용 AdMob 앱 ID가 필요하다. AdMob 콘솔에서 iOS 앱을 따로
// 만들면 다른 ~접미사의 ID가 나온다. 아직 iOS 앱을 안 만들었다면 아래 iOS 값을
// 실제 iOS 앱 ID로 바꿔야 한다(현재는 안드로이드와 동일 값 — iOS 빌드 시 교체 필요).
const ADMOB_ANDROID_APP_ID =
  process.env.ADMOB_ANDROID_APP_ID || 'ca-app-pub-1856287061134936~8519744143';
const ADMOB_IOS_APP_ID =
  process.env.ADMOB_IOS_APP_ID || 'ca-app-pub-1856287061134936~8519744143';

// Firebase(FCM) 설정 파일. 퍼블릭 레포라 파일을 커밋하지 않고 EAS의 file 타입
// 환경변수(GOOGLE_SERVICES_JSON)로 경로를 주입한다. 미설정이면 로컬의
// google-services.json을 쓰고, 그것도 없으면 FCM 없이 빌드된다(네이티브 푸시 미동작).
const fs = require('fs');
const GOOGLE_SERVICES_JSON =
  process.env.GOOGLE_SERVICES_JSON ||
  (fs.existsSync('./google-services.json') ? './google-services.json' : '');

// FCM 설정이 빠진 채로 빌드되면 네이티브 푸시가 조용히 죽는다(토큰 발급 실패 →
// 서버 등록 0대 → 앱 알림 안 감). 원인을 조기에 잡도록 빌드 로그에 크게 경고한다.
// 해결: eas env:create --environment <env> --name GOOGLE_SERVICES_JSON --type file
//       --value ./google-services.json --visibility secret  (docs/RELEASE.md 참고)
if (!GOOGLE_SERVICES_JSON) {
  console.warn(
    '\n[⚠ FCM] GOOGLE_SERVICES_JSON 미설정 — 이 빌드는 Firebase 설정 없이 만들어져 ' +
      '네이티브 푸시(FCM)가 동작하지 않습니다. EAS 파일 환경변수를 등록한 뒤 ' +
      '새 바이너리를 빌드하세요. (docs/RELEASE.md)\n',
  );
}

// 애드팝콘 오퍼월 매체 키 · 해시 키 (AdPopcorn 파트너스 대시보드 발급).
// EXPO_PUBLIC_ 접두사 — Android는 이 값을 여기(app.config.js, Node 시점)에서
// 읽어 plugins/withAdpopcorn.js로 AndroidManifest.xml meta-data에 주입하고,
// iOS는 Metro가 같은 값을 JS 번들에 그대로 인라인해 src/lib/adpopcorn.ts의
// setAppKey() 호출이 process.env.EXPO_PUBLIC_* 로 직접 읽는다. 두 플랫폼 다
// 결국 클라이언트(APK/IPA) 안에 평문으로 들어가는 값이라(매니페스트는 apktool로
// 누구나 추출 가능) EAS에는 sensitive가 아닌 plaintext로 등록해도 된다 —
// 절차: docs/RELEASE.md. 미설정이어도 오퍼월 카드가 안 열릴 뿐 앱 크래시는
// 없어 ADMOB_ANDROID_APP_ID와 달리 빌드를 막지 않는다.
const ADPOPCORN_APP_KEY = process.env.EXPO_PUBLIC_ADPOPCORN_APP_KEY || '';
const ADPOPCORN_HASH_KEY = process.env.EXPO_PUBLIC_ADPOPCORN_HASH_KEY || '';

module.exports = {
  expo: {
    name: '쇼핑로그',
    slug: 'webview',
    owner: 'shoppinglog',
    // 1.2.0: 애드팝콘 오퍼월 네이티브 모듈 추가. runtimeVersion(appVersion 정책)이
    // 갈리므로 이 버전의 JS(OTA)는 1.2.0 바이너리에만 배포된다 — 네이티브
    // 모듈이 없는 구버전 앱이 이 코드를 받아 죽는 일을 막는다.
    version: '1.2.0',
    runtimeVersion: {
      policy: 'appVersion',
    },
    updates: {
      url: 'https://u.expo.dev/fbefbc24-be24-43b4-99a1-208cdead860b',
    },
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'webview',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: 'store.shoppinglog.app',
      supportsTablet: true,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription: '상품 사진을 촬영해 업로드하기 위해 카메라를 사용합니다.',
        NSPhotoLibraryUsageDescription: '상품 사진을 선택해 업로드하기 위해 사진 보관함에 접근합니다.',
      },
    },
    android: {
      package: 'store.shoppinglog.app',
      permissions: ['android.permission.CAMERA'],
      adaptiveIcon: {
        backgroundColor: '#1371F9',
        foregroundImage: './assets/images/android-icon-foreground.png',
      },
      predictiveBackGestureEnabled: false,
      ...(GOOGLE_SERVICES_JSON ? { googleServicesFile: GOOGLE_SERVICES_JSON } : {}),
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      // Pretendard(웹과 동일 브랜드 서체)를 네이티브에 임베드해 로딩 화면
      // 태그라인 등 네이티브 Text에서 fontFamily:'Pretendard-Black'로 사용.
      // config plugin 방식이라 빌드 시 포함돼 첫 화면부터 지연 없이 적용된다.
      ['expo-font', { fonts: ['./assets/fonts/Pretendard-Black.otf'] }],
      [
        // 파란 배경(#1371F9) 가운데 곰돌이 아이콘. icon.png 코너색이 정확히
        // #1371F9 라, 이미지 배경과 splash backgroundColor 가 일치해 이음새
        // 없이 "파란 화면 + 중앙 곰돌이"로 보인다(런처 아이콘과도 통일).
        'expo-splash-screen',
        {
          image: './assets/images/icon.png',
          imageWidth: 288,
          resizeMode: 'contain',
          backgroundColor: '#1371F9',
        },
      ],
      [
        'expo-notifications',
        {
          color: '#208AEF',
        },
      ],
      [
        'expo-local-authentication',
        {
          faceIDPermission: '쇼핑로그 앱 잠금을 해제하기 위해 Face ID를 사용합니다.',
        },
      ],
      [
        '@react-native-seoul/kakao-login',
        {
          kakaoAppKey: KAKAO_NATIVE_APP_KEY,
          // 플러그인 기본값(Kotlin 1.5.10)이 Expo 모듈 최소 요구 버전(2.1.20)보다
          // 낮아 빌드가 깨짐. React Native 0.85가 쓰는 버전과 동일하게 고정한다.
          kotlinVersion: '2.1.20',
        },
      ],
      [
        'expo-build-properties',
        {
          android: {
            extraMavenRepos: ['https://devrepo.kakao.com/nexus/content/groups/public/'],
            // R8 최적화(코드/리소스 축소) — 플레이 콘솔 "앱이 최적화되지 않음" 경고 해소.
            // 앱 크기·메모리 감소. 단, 리플렉션 기반 SDK는 아래 keep 규칙으로 보호한다
            // (R8이 클래스명을 바꾸거나 제거하면 카카오/애드팝콘이 런타임 크래시).
            enableMinifyInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            extraProguardRules: [
              '# 카카오 로그인 SDK (리플렉션)',
              '-keep class com.kakao.** { *; }',
              '-keep class com.kakaoenterprise.** { *; }',
              '-dontwarn com.kakao.**',
              '# 애드팝콘(IGAWorks) 오퍼월 SDK',
              '-keep class com.igaworks.** { *; }',
              '-keep class com.adpopcorn.** { *; }',
              '-dontwarn com.igaworks.**',
              '# JavascriptInterface(웹뷰 브리지) 메서드 보존',
              '-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }',
            ].join('\n'),
          },
        },
      ],
      [
        'react-native-google-mobile-ads',
        { androidAppId: ADMOB_ANDROID_APP_ID, iosAppId: ADMOB_IOS_APP_ID },
      ],
      [
        './plugins/withAdpopcorn',
        { appKey: ADPOPCORN_APP_KEY, hashKey: ADPOPCORN_HASH_KEY },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      eas: {
        projectId: 'fbefbc24-be24-43b4-99a1-208cdead860b',
      },
    },
  },
};
