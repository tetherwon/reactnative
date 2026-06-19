# shoppinglog.store WebView 앱

[Expo](https://expo.dev) (React Native) 기반의 **WebView + 푸시 알림** 앱입니다.
[https://shoppinglog.store](https://shoppinglog.store) 를 풀스크린 WebView 로 띄우고,
Expo 푸시 알림을 등록합니다.

## 구조

| 파일 | 역할 |
| --- | --- |
| [src/app/index.tsx](src/app/index.tsx) | 풀스크린 WebView + 로딩 스피너 + 안드로이드 뒤로가기 + 푸시 연동 |
| [src/app/_layout.tsx](src/app/_layout.tsx) | 헤더 없는 단순 Stack 레이아웃 |
| [src/lib/notifications.ts](src/lib/notifications.ts) | 알림 핸들러 + Expo 푸시 토큰 등록 헬퍼 |

## 실행

```bash
npm install
npx expo start
```

> ⚠️ **푸시 알림은 Expo Go 에서 동작하지 않습니다 (SDK 53+ 부터 원격 푸시 미지원).**
> 푸시를 테스트하려면 [development build](https://docs.expo.dev/develop/development-builds/introduction/) 가 필요합니다.

```bash
# 1) EAS 프로젝트 연결 → app.json 에 extra.eas.projectId 자동 주입
npx eas init

# 2) 개발용 빌드 (실제 기기)
npx eas build --profile development --platform ios     # 또는 android
```

## 푸시 알림 동작

1. 앱 시작 시 [registerForPushNotificationsAsync()](src/lib/notifications.ts) 호출 → 권한 요청 후 **Expo 푸시 토큰**을 콘솔에 출력합니다.
2. 토큰으로 [Expo Push Tool](https://expo.dev/notifications) 에서 테스트 발송이 가능합니다.
3. 알림 데이터(`data`)에 `url` 이 있으면, 알림을 탭했을 때 해당 URL 로 WebView 가 이동합니다.

   ```json
   {
     "to": "ExponentPushToken[...]",
     "title": "주문 알림",
     "body": "새 주문이 들어왔어요",
     "data": { "url": "https://shoppinglog.store/orders" }
   }
   ```

## 메모

- 실제 푸시 토큰 발급은 **실제 기기**에서만 가능합니다 (시뮬레이터/에뮬레이터 불가).
- 안드로이드는 토큰 발급 전 `default` 알림 채널을 등록합니다.
- 띄우는 URL 은 [src/app/index.tsx](src/app/index.tsx) 의 `HOME_URL` 상수에서 변경할 수 있습니다.
