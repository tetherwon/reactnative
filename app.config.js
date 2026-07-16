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
// 환경변수(GOOGLE_SERVICES_JSON / GOOGLE_SERVICES_INFO_PLIST)로 경로를 주입한다.
// 미설정이면 로컬 파일을 쓰고, 그것도 없으면 FCM 없이 빌드된다(네이티브 푸시 미동작).
const fs = require('fs');
const GOOGLE_SERVICES_JSON =
  process.env.GOOGLE_SERVICES_JSON ||
  (fs.existsSync('./google-services.json') ? './google-services.json' : '');
// iOS FCM용 (Firebase 콘솔 → iOS 앱 등록 후 다운로드, APNs 인증 키 업로드 필수).
const GOOGLE_SERVICES_INFO_PLIST =
  process.env.GOOGLE_SERVICES_INFO_PLIST ||
  (fs.existsSync('./GoogleService-Info.plist') ? './GoogleService-Info.plist' : '');

// @react-native-firebase/app 플러그인은 iOS·Android 설정 파일이 "둘 다" 없으면
// prebuild 단계에서 throw 한다. 파일이 다 준비된 빌드에서만 플러그인을 켠다
// (플러그인이 꺼져도 pod은 설치되므로 JS 쪽 호출은 try/catch로 격리돼 있다 —
// src/lib/notifications.ts 참고). iOS FCM을 쓰려면 EAS에 두 env 모두 등록할 것.
const FIREBASE_CONFIGURED = Boolean(GOOGLE_SERVICES_JSON && GOOGLE_SERVICES_INFO_PLIST);

if (!KAKAO_NATIVE_APP_KEY) {
  // 키가 비면 iOS URL 스킴이 "kakao"(접미사 없음)로 등록돼 카카오 네이티브
  // 로그인이 조용히 깨진다. 빌드 로그에서 바로 보이도록 경고를 남긴다.
  console.warn(
    '[app.config] KAKAO_NATIVE_APP_KEY 미설정 — 카카오 네이티브 로그인이 동작하지 않는 빌드가 됩니다.',
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
    // 1.3.0: Firebase Messaging(iOS FCM)·expo-tracking-transparency(ATT) 네이티브
    // 모듈 추가. runtimeVersion(appVersion 정책)이 갈리므로 이 버전의 JS(OTA)는
    // 1.3.0 바이너리에만 배포된다 — 네이티브 모듈이 없는 구버전 앱이 이 코드를
    // 받아 죽는 일을 막는다. (1.2.0: 애드팝콘 오퍼월 추가)
    version: '1.3.0',
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
      // iPhone 전용 — 웹 레이아웃이 태블릿 검증돼 있지 않고, true면 iPad
      // 스크린샷 제출·심사 대상이 늘어난다. (iPad에서도 확대 모드로 실행은 가능)
      supportsTablet: false,
      ...(GOOGLE_SERVICES_INFO_PLIST ? { googleServicesFile: GOOGLE_SERVICES_INFO_PLIST } : {}),
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription: '상품 사진을 촬영해 업로드하기 위해 카메라를 사용합니다.',
        NSPhotoLibraryUsageDescription: '상품 사진을 선택해 업로드하기 위해 사진 보관함에 접근합니다.',
        // 결제(앱카드·ISP)·본인인증(PASS) 앱 스킴. iOS는 여기 선언된 스킴만
        // canOpenURL이 true를 돌려준다(열기 자체는 선언 없이도 가능 —
        // src/lib/externalLinks.ts 참고). PG 연동 가이드의 표준 목록 기준이며,
        // 카카오 로그인용 스킴(kakaokompassauth 등)은 카카오 플러그인이 따로 넣는다.
        LSApplicationQueriesSchemes: [
          // 간편결제·메신저
          'kakaotalk', 'supertoss', 'payco', 'lpayapp', 'lmslpay',
          // ISP/공용 결제
          'ispmobile', 'kftc-bankpay', 'cloudpay',
          // 카드사 앱카드
          'kb-acp', 'liivbank', 'newliiv',
          'shinhan-sr-ansimclick', 'smshinhanansimclick',
          'hdcardappcardansimclick', 'smhyundaiansimclick',
          'lotteappcard', 'lottesmartpay',
          'nhappcardansimclick', 'nhallonepayansimclick',
          'citispay', 'citicardappkr', 'citimobileapp',
          'wooripay', 'com.wooricard.wcard',
          'shinsegaeeasypayment', 'hanawalletmembers',
          // 통신사 본인인증(PASS)
          'tauthlink', 'ktauthexternalcall', 'upluscorporation',
        ],
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
      // iOS FCM — 서버(/api/push/fcm/register)가 raw FCM 토큰만 받으므로 iOS도
      // Firebase Messaging으로 FCM 등록 토큰을 발급한다(expo-notifications의
      // getDevicePushTokenAsync는 iOS에서 APNs 토큰이라 서버가 못 쓴다).
      // 설정 파일이 없으면 플러그인이 prebuild에서 throw 하므로 조건부로 켠다.
      ...(FIREBASE_CONFIGURED ? ['@react-native-firebase/app'] : []),
      // iOS ATT(앱 추적 투명성) 문구 — AdMob·애드팝콘 둘 다 IDFA를 쓰므로 필수.
      // 권한 요청 시점은 첫 광고/오퍼월 진입 직전(src/lib/tracking.ts).
      [
        'expo-tracking-transparency',
        {
          userTrackingPermission:
            '맞춤 광고를 제공하고 리워드 적립을 정확히 확인하기 위해 사용됩니다.',
        },
      ],
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
          ios: {
            // Firebase iOS SDK(@react-native-firebase)는 정적 프레임워크 링크가
            // 필수다. pod은 조건부 플러그인과 무관하게 autolinking으로 항상
            // 설치되므로 이 설정도 항상 켜 둔다.
            useFrameworks: 'static',
          },
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
        {
          androidAppId: ADMOB_ANDROID_APP_ID,
          iosAppId: ADMOB_IOS_APP_ID,
          // iOS 광고 어트리뷰션(SKAdNetwork). 플러그인이 자동 주입하지 않으므로
          // 직접 나열해야 한다 — 빠지면 iOS 광고 성과 측정·수익이 크게 깎인다.
          // 목록 출처: react-native-google-mobile-ads 공식 문서(= Google 권장 목록,
          // https://developers.google.com/admob/ios/quick-start#update_your_infoplist)
          skAdNetworkItems: [
            'cstr6suwn9.skadnetwork', '4fzdc2evr5.skadnetwork', '2fnua5tdw4.skadnetwork',
            'ydx93a7ass.skadnetwork', 'p78axxw29g.skadnetwork', 'v72qych5uu.skadnetwork',
            'ludvb6z3bs.skadnetwork', 'cp8zw746q7.skadnetwork', '3sh42y64q3.skadnetwork',
            'c6k4g5qg8m.skadnetwork', 's39g8k73mm.skadnetwork', 'wg4vff78zm.skadnetwork',
            '3qy4746246.skadnetwork', 'f38h382jlk.skadnetwork', 'hs6bdukanm.skadnetwork',
            'mlmmfzh3r3.skadnetwork', 'v4nxqhlyqp.skadnetwork', 'wzmmz9fp6w.skadnetwork',
            'su67r6k2v3.skadnetwork', 'yclnxrl5pm.skadnetwork', 't38b2kh725.skadnetwork',
            '7ug5zh24hu.skadnetwork', 'gta9lk7p23.skadnetwork', 'vutu7akeur.skadnetwork',
            'y5ghdn5j9k.skadnetwork', 'v9wttpbfk9.skadnetwork', 'n38lu8286q.skadnetwork',
            '47vhws6wlr.skadnetwork', 'kbd757ywx3.skadnetwork', '9t245vhmpl.skadnetwork',
            'a2p9lx4jpn.skadnetwork', '22mmun2rn5.skadnetwork', '44jx6755aq.skadnetwork',
            'k674qkevps.skadnetwork', '4468km3ulz.skadnetwork', '2u9pt9hc89.skadnetwork',
            '8s468mfl3y.skadnetwork', 'klf5c3l5u5.skadnetwork', 'ppxm28t8ap.skadnetwork',
            'kbmxgpxpgc.skadnetwork', 'uw77j35x4d.skadnetwork', '578prtvx9j.skadnetwork',
            '4dzt52r2t5.skadnetwork', 'tl55sbb4fm.skadnetwork', 'c3frkrj4fj.skadnetwork',
            'e5fvkxwrpn.skadnetwork', '8c4e2ghe7u.skadnetwork', '3rd42ekr43.skadnetwork',
            '97r2b46745.skadnetwork', '3qcr597p9d.skadnetwork',
          ],
        },
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
