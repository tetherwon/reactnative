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
        { androidAppId: ADMOB_ANDROID_APP_ID, iosAppId: ADMOB_IOS_APP_ID },
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
