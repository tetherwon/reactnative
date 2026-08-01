// 카카오 네이티브 앱 키는 퍼블릭 레포에 평문으로 남기지 않기 위해
// EAS 환경변수(KAKAO_NATIVE_APP_KEY)로 주입한다. (app.json 대신 app.config.js 사용 이유)
const KAKAO_NATIVE_APP_KEY = process.env.KAKAO_NATIVE_APP_KEY || '';

// ⚠️ 키가 비면 strings.xml kakao_app_key="" + 콜백 스킴이 "kakao"(키 미포함)로
// 박힌 바이너리가 만들어진다. 그 앱은 카카오톡 앱투앱 인증을 증명하지 못해
// 콘솔에 키 해시를 아무리 맞게 등록해도 항상 계정(아이디/비번) 로그인으로
// 폴백한다 — 실제로 이 원인으로 한참 헤맸다. 핵심 로그인 기능이므로 EAS
// 빌드에서는 조용히 넘어가지 않고 즉시 실패시킨다.
// 해결: 빌드에 쓰는 EAS 환경(preview/production 각각!)에 KAKAO_NATIVE_APP_KEY 등록.
//       eas env:list --environment preview 로 확인. (docs/RELEASE.md)
// ⚠️ 이 가드는 EAS 빌드만 막는다는 구멍이 있었다. 로컬 빌드(expo prebuild /
// run:android)는 EAS_BUILD가 없어 키가 비어도 조용히 통과 → 버전은 같은데
// 카카오톡 로그인만 안 되는 바이너리가 나온다(이 경로로 한 번 더 헤맸다).
// 그래서 네이티브 산출물을 만드는 커맨드면 로컬에서도 즉시 실패시키고,
// 그 외(dev 서버 등)에서도 최소한 경고는 남긴다.
const _isNativeBuildCmd = process.argv.some(
  (a) => a === 'prebuild' || a === 'run:android' || a === 'run:ios',
);
if (!KAKAO_NATIVE_APP_KEY) {
  if (process.env.EAS_BUILD === 'true') {
    throw new Error(
      '[카카오 로그인] KAKAO_NATIVE_APP_KEY 미설정 — 이대로 빌드하면 카카오톡 ' +
        '간편로그인이 아이디/비번 입력으로 폴백하는 바이너리가 나온다. ' +
        '이 빌드가 쓰는 EAS 환경(예: preview)에 KAKAO_NATIVE_APP_KEY를 등록할 것.',
    );
  }
  if (_isNativeBuildCmd) {
    throw new Error(
      '[카카오 로그인] KAKAO_NATIVE_APP_KEY 미설정 (로컬 빌드) — 카카오톡 간편로그인이 ' +
        '아이디/비번 화면으로 폴백하는 바이너리가 나온다. 빌드 전에 키를 넣을 것:\n' +
        '  KAKAO_NATIVE_APP_KEY=<네이티브앱키> npx expo run:android\n' +
        '  (또는 셸에 export 후 빌드)',
    );
  }
  console.warn(
    '[카카오 로그인] KAKAO_NATIVE_APP_KEY 가 비어 있음 — 이 설정으로 만든 네이티브 ' +
      '바이너리는 카카오톡 앱투앱 로그인이 동작하지 않고 아이디/비번 화면으로 폴백한다.',
  );
}

// AdMob 앱 ID (ca-app-pub-XXXX~YYYY, AdMob 콘솔 → 앱 설정).
// AdMob 앱 ID는 비밀값이 아니라 어차피 빌드된 앱에 그대로 박히는 공개값이므로
// 여기에 직접 등록한다(env로 덮어쓰기 가능). 이렇게 하면 EAS 환경변수를 깜빡
// 잊어 "Invalid application ID" 크래시로 심사 거절되던 위험이 원천 차단된다.
//
// ⚠️ iOS는 별도의 iOS용 AdMob 앱 ID가 필요하다(AdMob 콘솔에서 iOS 앱을 따로
// 만들면 다른 ~접미사의 ID가 나온다). 예전엔 안드로이드 ID를 기본값으로 두고
// "iOS 빌드 시 교체 필요"라고만 적어놨는데, 그러면 교체를 깜빡한 채 빌드가
// 성공해버리고 번들 ID에 등록되지 않은 앱 ID가 심겨 리워드 광고가 전부 로드
// 실패한다(GADApplicationIdentifier 불일치는 초기화 자체를 깨뜨리기도 한다).
// 안드로이드와 마찬가지로 실제 ID를 여기 직접 둔다(env로 덮어쓰기 가능).
// 접미사(~뒤)가 서로 달라야 정상 — 같다면 iOS 앱을 아직 안 만든 것이다.
const ADMOB_ANDROID_APP_ID =
  process.env.ADMOB_ANDROID_APP_ID || 'ca-app-pub-1856287061134936~8519744143';
const ADMOB_IOS_APP_ID =
  process.env.ADMOB_IOS_APP_ID || 'ca-app-pub-1856287061134936~6447506732';

// 두 값이 같으면 iOS 앱 ID를 아직 안 만든 것이다(번들 ID 불일치로 광고 전부
// 로드 실패). iOS 네이티브 산출물을 만드는 시점에만 막는다.
const _isIosBuild =
  process.env.EAS_BUILD_PLATFORM === 'ios' || process.argv.includes('run:ios');
if (_isIosBuild && ADMOB_IOS_APP_ID === ADMOB_ANDROID_APP_ID) {
  throw new Error(
    '[AdMob] iOS 앱 ID가 안드로이드와 동일 — 번들 ID와 맞지 않아 리워드 광고가 ' +
      '전부 로드 실패한다. AdMob 콘솔에서 iOS 앱을 만들고 그 앱 ID를 쓸 것.',
  );
}

// SKAdNetwork 식별자 — ATT를 거부한 사용자에 대해 광고 네트워크가 설치 전환을
// 귀속시키는 애플의 프레임워크. Info.plist에 이 목록이 없으면 광고주가 전환을
// 추적할 수 없어 입찰이 붙지 않고 iOS eCPM이 크게 떨어진다(거절 사유는 아니다).
// react-native-google-mobile-ads 플러그인은 skAdNetworkItems 옵션이 없으면
// 아무것도 넣지 않으므로(undefined면 early return) 반드시 직접 넘겨야 한다.
// 출처: node_modules/react-native-google-mobile-ads/docs/index.mdx 의 권장 목록.
// ⚠️ 구글이 수시로 갱신하므로 SDK를 올릴 때 위 문서에서 다시 뽑아 동기화할 것.
const ADMOB_SKADNETWORK_ITEMS = [
  'cstr6suwn9.skadnetwork',
  '4fzdc2evr5.skadnetwork',
  '2fnua5tdw4.skadnetwork',
  'ydx93a7ass.skadnetwork',
  'p78axxw29g.skadnetwork',
  'v72qych5uu.skadnetwork',
  'ludvb6z3bs.skadnetwork',
  'cp8zw746q7.skadnetwork',
  '3sh42y64q3.skadnetwork',
  'c6k4g5qg8m.skadnetwork',
  's39g8k73mm.skadnetwork',
  'wg4vff78zm.skadnetwork',
  '3qy4746246.skadnetwork',
  'f38h382jlk.skadnetwork',
  'hs6bdukanm.skadnetwork',
  'mlmmfzh3r3.skadnetwork',
  'v4nxqhlyqp.skadnetwork',
  'wzmmz9fp6w.skadnetwork',
  'su67r6k2v3.skadnetwork',
  'yclnxrl5pm.skadnetwork',
  't38b2kh725.skadnetwork',
  '7ug5zh24hu.skadnetwork',
  'gta9lk7p23.skadnetwork',
  'vutu7akeur.skadnetwork',
  'y5ghdn5j9k.skadnetwork',
  'v9wttpbfk9.skadnetwork',
  'n38lu8286q.skadnetwork',
  '47vhws6wlr.skadnetwork',
  'kbd757ywx3.skadnetwork',
  '9t245vhmpl.skadnetwork',
  'a2p9lx4jpn.skadnetwork',
  '22mmun2rn5.skadnetwork',
  '44jx6755aq.skadnetwork',
  'k674qkevps.skadnetwork',
  '4468km3ulz.skadnetwork',
  '2u9pt9hc89.skadnetwork',
  '8s468mfl3y.skadnetwork',
  'klf5c3l5u5.skadnetwork',
  'ppxm28t8ap.skadnetwork',
  'kbmxgpxpgc.skadnetwork',
  'uw77j35x4d.skadnetwork',
  '578prtvx9j.skadnetwork',
  '4dzt52r2t5.skadnetwork',
  'tl55sbb4fm.skadnetwork',
  'c3frkrj4fj.skadnetwork',
  'e5fvkxwrpn.skadnetwork',
  '8c4e2ghe7u.skadnetwork',
  '3rd42ekr43.skadnetwork',
  '97r2b46745.skadnetwork',
  '3qcr597p9d.skadnetwork',
];

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
    // 1.3.0: 하이브리드 네이티브 화면 15종 + react-native-svg·expo-clipboard
    // 네이티브 모듈 추가. runtimeVersion(appVersion 정책)이 갈리므로 이 버전의
    // JS(OTA)는 같은 버전 바이너리에만 배포된다 — 모듈이 없는 구버전 앱이
    // 이 코드를 받아 죽는 일을 막는다. (1.2.0: 애드팝콘 오퍼월 추가,
    // 1.3.1: 애드팝콘 매니페스트 앱키 이름 수정, 1.3.2: 카카오톡 패키지 가시성
    // <queries> 선언 추가 — 콘솔 키 해시를 다 맞게 등록해도 이게 없으면
    // Android 11+에서 카카오톡 설치 여부를 못 봐 항상 웹뷰 로그인으로 폴백함.
    // 1.3.3: expo-tracking-transparency(ATT) 추가 + SKAdNetwork 식별자 주입.
    // 전부 네이티브 매니페스트 변경이라 새 빌드 필수)
    version: '1.3.3',
    runtimeVersion: {
      policy: 'appVersion',
    },
    updates: {
      url: 'https://u.expo.dev/fbefbc24-be24-43b4-99a1-208cdead860b',
    },
    // Android 16부터 폴더블·태블릿에서는 방향/크기 제한이 무시된다. 제한을 걸어둬도
    // 대형 화면에서는 어차피 회전하므로, Play Console 권고대로 제한을 없앤다
    // (android:screenOrientation="portrait" 가 매니페스트에서 빠진다).
    // 콘텐츠는 max-width 640px 모바일 웹이라 가로에서도 가운데 정렬로 표시된다.
    orientation: 'default',
    icon: './assets/images/icon.png',
    scheme: 'webview',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: 'store.shoppinglog.app',
      // 아이폰 전용으로 제출한다(iPad 미지원). 콘텐츠가 max-width 640px 모바일
      // 웹이라 iPad 전체 화면에서는 양옆이 크게 비어 "아이패드에 맞게 최적화되지
      // 않음"(가이드라인 4.2 Minimum Functionality)으로 거절되기 쉽고, iPad용
      // 스크린샷 세트도 따로 요구된다. false면 iPad에서는 아이폰 호환 모드로
      // 실행돼 레이아웃이 깨지지 않고, 심사 대상 기기도 아이폰으로만 좁혀진다.
      // 나중에 태블릿 레이아웃을 실제로 대응하면 true로 되돌릴 것.
      supportsTablet: false,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription: '상품 사진을 촬영해 업로드하기 위해 카메라를 사용합니다.',
        NSPhotoLibraryUsageDescription: '상품 사진을 선택해 업로드하기 위해 사진 보관함에 접근합니다.',
        // 광고 SDK(AdMob·애드팝콘)가 ATT 권한을 요청하는데 이 문구가 없으면
        // iOS가 요청 시점에 프로세스를 즉시 종료한다(심사 거절 사유이기도 하다).
        NSUserTrackingUsageDescription:
          '맞춤형 광고와 적립 보상 지급 확인을 위해 기기 광고 식별자를 사용합니다.',
        // iOS의 Linking.canOpenURL은 여기 없는 스킴에 무조건 false를 돌려준다.
        // 빠지면 결제·본인인증 앱으로 넘어가는 링크가 '아무 반응 없음'이 된다
        // (안드로이드는 intent:// 분기로 우회하지만 iOS엔 그 경로가 없다).
        // 카카오 3종(kakaokompassauth/storykompassauth/kakaolink)은
        // @react-native-seoul/kakao-login 플러그인이 따로 넣으므로 여기선 생략.
        LSApplicationQueriesSchemes: [
          'itms-apps', // 앱스토어(미설치 앱 유도)
          'kakaotalk', // 카카오톡
          'kakaopay', // 카카오페이
          'supertoss', // 토스
          'ispmobile', // ISP/페이북
          'kftc-bankpay', // 금융결제원 뱅크페이
          'hdcardappcardansimclick', // 현대카드
          'shinhan-sr-ansimclick', // 신한카드
          'kb-acp', // KB국민카드
          'mpocket.online.ansimclick', // 삼성카드
          'lotteappcard', // 롯데카드
          'cloudpay', // 하나카드
          'nhallonepayansimclick', // NH농협카드
          'citispay', // 씨티카드
          'payco', // 페이코
          'nidlogin', // 네이버
          'coupang', // 쿠팡
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
              '# RN 카카오 로그인 래퍼(@react-native-seoul/kakao-login) — com.kakao.**',
              '# keep만으로는 이 모듈 클래스가 보호되지 않아 릴리즈(R8)에서만 죽을 수 있다',
              '-keep class com.dooboolab.** { *; }',
              '-dontwarn com.dooboolab.**',
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
          skAdNetworkItems: ADMOB_SKADNETWORK_ITEMS,
        },
      ],
      [
        './plugins/withAdpopcorn',
        { appKey: ADPOPCORN_APP_KEY, hashKey: ADPOPCORN_HASH_KEY },
      ],
      // 카카오톡 앱-투-앱(원탭) 로그인에 필요한 패키지 가시성 선언. 콘솔 키 해시가
      // 다 맞아도 이게 없으면 Android 11+에서 항상 웹뷰(아이디/비번) 로그인으로 빠진다.
      './plugins/withKakaoQueries',
      './plugins/withAndroidOptimizations',
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
