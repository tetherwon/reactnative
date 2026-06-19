# 푸시 알림 — 백엔드 설계 & 연동 문서

> 이 앱은 **Expo (React Native) WebView 앱**입니다.
> 프론트엔드는 **Expo 푸시 토큰 발급 + 토큰을 백엔드로 전달**까지 완료되어 있습니다.
> 이 문서는 **백엔드에서 해야 할 일**(토큰 저장 + 발송)을 정리한 것입니다.

---

## 1. 전체 흐름

```
[앱·프론트]                         [백엔드]                    [Expo Push Service]
   │ 권한요청                           │                              │
   │ getExpoPushToken()                 │                              │
   │ ── POST /push-tokens (토큰) ─────► │ 토큰 DB 저장                  │
   │                                    │                              │
   │                ...주문/이벤트 발생...│                              │
   │                                    │ ── POST /push/send ────────► │
   │                                    │   (토큰 + title/body/data)    │
   │                                    │                              │ ── APNs/FCM ──► [기기]
   │ ◄──────── 알림 도착 ──────────────────────────────────────────────────────────┘
   │ 알림 탭 → data.url 로 웹뷰 이동      │                              │
```

**경계 요약**
- 프론트: 토큰 발급 → 백엔드로 전송 / 알림 수신·탭 처리
- 백엔드: **토큰 저장 + Expo Push API 로 발송 + 발송 결과(영수증) 정리**

---

## 2. 백엔드가 만들 것

### 2-1. 토큰 등록 API  ⭐ 가장 먼저 필요

프론트가 앱 시작 시 자동으로 아래 요청을 보냅니다. **이 엔드포인트만 만들어서 URL 을 알려주면** 프론트는 코드의 `PUSH_TOKEN_ENDPOINT` 한 줄만 채우면 연동 끝납니다. (파일: `src/lib/notifications.ts`)

**요청 (프론트 → 백엔드)**
```http
POST /push-tokens
Content-Type: application/json

{
  "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "platform": "ios",          // "ios" | "android"
  "deviceName": "iPhone 15"    // nullable
}
```
> 로그인/유저 식별이 필요하면 `Authorization` 헤더로 유저를 붙이세요. (프론트에서 헤더 추가는 쉬움 — 요청만 주세요.)

**응답**
```json
{ "ok": true }
```

**처리 로직**
- 같은 `token` 이 이미 있으면 **UPSERT**(중복 저장 금지, `updatedAt` 갱신).
- 유저당 기기가 여러 개일 수 있으니 `user_id : token` 은 **1:N**.

### 2-2. 저장 스키마 (예시)

```sql
CREATE TABLE push_tokens (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT,                 -- 로그인 연동 시
  token       TEXT NOT NULL UNIQUE,   -- ExponentPushToken[...]
  platform    TEXT,                   -- ios | android
  device_name TEXT,
  is_active   BOOLEAN DEFAULT TRUE,   -- 죽은 토큰 비활성화용
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```

---

## 3. 푸시 발송 (Expo Push API)

백엔드는 **Expo 가 제공하는 HTTP API** 로 발송합니다. APNs/FCM 을 직접 다룰 필요 없음.

### 3-1. 발송 엔드포인트
```http
POST https://exp.host/--/api/v2/push/send
Content-Type: application/json
Accept: application/json
```

### 3-2. 메시지 형식
```json
[
  {
    "to": "ExponentPushToken[xxxx]",
    "title": "주문 알림",
    "body": "새 주문이 들어왔어요",
    "sound": "default",
    "badge": 1,
    "channelId": "default",
    "data": { "url": "https://shoppinglog.store/orders" }
  }
]
```

| 필드 | 설명 |
|---|---|
| `to` | 대상 토큰. **배열로 한 번에 최대 100개**까지 보낼 수 있음 |
| `title` / `body` | 알림 제목 / 본문 |
| `sound` | `"default"` 권장 |
| `channelId` | 안드로이드 채널. 프론트가 `"default"` 채널을 등록해 둠 → **`"default"` 로 보내세요** |
| `data.url` | ⭐ **규약**: 여기에 URL 을 넣으면, 사용자가 알림을 탭했을 때 앱이 해당 URL 로 웹뷰를 이동시킵니다 |

> `data` 에는 URL 외 다른 값도 자유롭게 실어 보낼 수 있지만, **`url` 키만 프론트가 특별 처리**합니다.

### 3-3. curl 테스트
```bash
curl -X POST https://exp.host/--/api/v2/push/send \
  -H "Content-Type: application/json" \
  -d '[{
    "to": "ExponentPushToken[xxxx]",
    "title": "테스트",
    "body": "백엔드 발송 테스트",
    "data": { "url": "https://shoppinglog.store/orders" }
  }]'
```

### 3-4. Node.js 예시 (공식 SDK 권장)
```bash
npm install expo-server-sdk
```
```js
import { Expo } from 'expo-server-sdk';
const expo = new Expo(); // 액세스 토큰 쓰면 new Expo({ accessToken })

async function sendPush(tokens, { title, body, data }) {
  // 유효한 Expo 토큰만 필터
  const messages = tokens
    .filter((t) => Expo.isExpoPushToken(t))
    .map((to) => ({ to, sound: 'default', title, body, data, channelId: 'default' }));

  // 100개씩 청크로 발송
  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];
  for (const chunk of chunks) {
    tickets.push(...(await expo.sendPushNotificationsAsync(chunk)));
  }
  return tickets; // 영수증 조회용 ticket id 포함
}
```

---

## 4. 발송 결과 처리 (중요 — 죽은 토큰 정리)

발송하면 **ticket** 이 오고, 잠시 후 **receipt** 로 최종 결과를 확인합니다.

```js
// 1) ticket 에서 receiptId 모으기
const receiptIds = tickets.filter((t) => t.status === 'ok').map((t) => t.id);

// 2) 영수증 조회
const receiptChunks = expo.chunkPushNotificationReceiptIds(receiptIds);
for (const chunk of receiptChunks) {
  const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
  for (const [id, receipt] of Object.entries(receipts)) {
    if (receipt.status === 'error') {
      // ⭐ DeviceNotRegistered → 해당 토큰 비활성화/삭제
      if (receipt.details?.error === 'DeviceNotRegistered') {
        // is_active = false 처리
      }
    }
  }
}
```

> `DeviceNotRegistered` (앱 삭제/토큰 만료) 토큰을 계속 두면 발송 실패가 쌓입니다. **꼭 정리**하세요.

---

## 5. 크레덴셜 (배포 전 준비 — 누구 책임인지 합의)

푸시가 **실제 기기까지 도착**하려면 아래가 필요합니다. (개발/테스트 단계가 아니라 **빌드·배포** 단계에서 필요)

| 항목 | 담당(권장) | 비고 |
|---|---|---|
| EAS `projectId` | 프론트 (`eas init`) | **클라이언트 Expo 계정** 필요 |
| iOS APNs 키 | 클라이언트 제공 → EAS 관리 | **Apple Developer 계정 ($99/년)** |
| Android FCM | 프론트/클라 설정 | Firebase 프로젝트 → service account 키를 EAS 에 업로드 |
| (선택) Expo Access Token | 백엔드 | 발송 보안 강화 시 `new Expo({ accessToken })` |

> ⚠️ **Expo Go 에서는 원격 푸시가 안 됩니다(SDK 53+).** 테스트는 반드시 **development build** 로 하세요.

---

## 6. 연동 체크리스트

**백엔드**
- [ ] `POST /push-tokens` 구현 → **URL 을 프론트에 전달** (이거 하나면 프론트 연동 끝)
- [ ] 토큰 UPSERT 저장 (token UNIQUE)
- [ ] Expo Push API 발송 (`channelId: "default"`, 필요 시 `data.url`)
- [ ] 100개 청크 발송 + 영수증으로 `DeviceNotRegistered` 토큰 정리

**프론트 (완료됨)**
- [x] 토큰 발급 후 `POST /push-tokens` 자동 호출 (URL 만 채우면 동작)
- [x] 알림 탭 시 `data.url` 로 웹뷰 이동

---

## 7. 프론트 연동 포인트 (참고)

| 위치 | 내용 |
|---|---|
| `src/lib/notifications.ts` 의 `PUSH_TOKEN_ENDPOINT` | 백엔드가 준 토큰 등록 URL 을 넣는 곳 |
| `src/lib/notifications.ts` 의 `sendTokenToBackend()` | 토큰을 보내는 요청 형식 (위 2-1 과 동일) |
| `src/app/index.tsx` 의 알림 탭 리스너 | `data.url` → 웹뷰 이동 처리 |
