// 카카오 네이티브 앱 키는 퍼블릭 레포에 평문으로 남기지 않기 위해
// EAS 환경변수(KAKAO_NATIVE_APP_KEY)로 주입한다. (app.json 대신 app.config.js 사용 이유)
const KAKAO_NATIVE_APP_KEY = process.env.KAKAO_NATIVE_APP_KEY || '';

// AdMob 앱 ID (ca-app-pub-XXXX~YYYY, AdMob 콘솔 → 앱 설정). EAS 환경변수로 주입.
//
// ⚠️ GMA SDK는 앱이 광고를 안 불러도 매니페스트에 유효한 앱 ID가 없으면
// "Invalid application ID"를 던지며 앱 시작 자체를 죽인다. 실제로 이 크래시로
// 플레이스토어 심사에서 거절당한 적 있음("설치되지만 로드되지 않음").
// 그래서: production 빌드는 앱 ID 없이는 빌드를 실패시키고(깨진 앱 출고 방지),
// 그 외(개발/프리뷰)는 Google 공식 샘플 앱 ID로 대체해 크래시만 막는다.
const ADMOB_ANDROID_APP_ID = process.env.ADMOB_ANDROID_APP_ID || '';
const ADMOB_SAMPLE_APP_ID = 'ca-app-pub-3940256099942544~3347511713'; // Google 공식 샘플
if (process.env.EAS_BUILD_PROFILE === 'production' && !ADMOB_ANDROID_APP_ID) {
  throw new Error(
    'ADMOB_ANDROID_APP_ID 가 설정되지 않았습니다. 이대로 빌드하면 앱이 시작 시 ' +
      '크래시합니다(플레이 심사 거절 사유). EAS production 환경변수에 AdMob 앱 ID를 ' +
      '추가한 뒤 다시 빌드하세요 — 절차: docs/RELEASE.md',
  );
}

// Firebase(FCM) 설정 파일. 퍼블릭 레포라 파일을 커밋하지 않고 EAS의 file 타입
// 환경변수(GOOGLE_SERVICES_JSON)로 경로를 주입한다. 미설정이면 로컬의
// google-services.json을 쓰고, 그것도 없으면 FCM 없이 빌드된다(네이티브 푸시 미동작).
const fs = require('fs');
const GOOGLE_SERVICES_JSON =
  process.env.GOOGLE_SERVICES_JSON ||
  (fs.existsSync('./google-services.json') ? './google-services.json' : '');

module.exports = {
  expo: {
    name: '쇼핑로그',
    slug: 'webview',
    owner: 'shoppinglog',
    // 1.1.0: AdMob·FCM 네이티브 모듈 추가. runtimeVersion(appVersion 정책)이
    // 갈리므로 이 버전의 JS(OTA)는 1.1.0 바이너리에만 배포된다 — 네이티브
    // 모듈이 없는 구버전(1.0.0) 앱이 이 코드를 받아 죽는 일을 막는다.
    version: '1.1.0',
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
      [
        // "이미지 없는 스플래시"가 목표지만, expo-splash-screen 은 image 를
        // 빼면 생성된 테마가 존재하지 않는 drawable(splashscreen_logo)을
        // 참조해서 리소스 링킹이 깨진다(processReleaseResources 실패).
        // 그래서 완전 투명 PNG를 넣는다 — 빌드가 성공하고 화면상으론
        // 순수 흰 배경이라 부팅 직후 웹뷰 로딩 스피너로 자연스럽게 이어진다.
        'expo-splash-screen',
        {
          image: './assets/images/splash-blank.png',
          imageWidth: 100,
          backgroundColor: '#ffffff',
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
          },
        },
      ],
      [
        'react-native-google-mobile-ads',
        { androidAppId: ADMOB_ANDROID_APP_ID || ADMOB_SAMPLE_APP_ID },
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
