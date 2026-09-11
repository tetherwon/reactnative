# 시작 화면 및 앱 잠금 리뷰

대상: 2026-09-11 로컬 `refactor/webview-screen`의 아래 파일 전체.
테스트는 실제 TSX를 transpile해 React hook/native API를 mock한 Node VM에서 실행했다.
실기기 Face ID, Android 프로세스 시작, 네트워크 로딩을 확인한 결과는 아니다.

| 파일 | 검토 범위 | 결과 |
| --- | --- | --- |
| `src/app/_layout.tsx` | 1–28행 | 전체 화면에 AppLockGate가 적용된다. 로그인 상태를 전달하지 않는다. ATT 중복 호출은 tracking 모듈에서 병합된다. |
| `src/components/AppLockGate.tsx` | 1–191행 | iOS 생체 인증 등록 기기는 비로그인 상태도 잠근다. 인증 취소 후 WebView는 계속 마운트되어 있지만 불투명 잠금 화면에 가려진다. |
| `src/lib/authGate.ts` | 1–77행 | PKCE 시작/취소/교환 함수. 비로그인 초기 렌더에서 자체적으로 네트워크나 인증을 시작하지 않는다. 초기 실행을 막는 결함을 찾지 못했다. |
| `src/lib/nativePrompts.ts` | 1–30행 | active 상태 대기 및 직렬 큐. reject는 다음 요청을 막지 않는다. 완료되지 않는 native Promise에는 시간 제한이 없다. |
| `src/lib/tracking.ts` | 1–33행 | iOS ATT의 진행 중 요청 병합, 실패 처리, undetermined 재시도 경로를 확인했다. |
| `src/components/WebViewSplash.tsx` | 1–70행 | 분리 후 상대 asset 경로 및 크기별 이미지 사용 정상. 자체 비동기 대기나 인증 조건 없음. |
| `src/components/ConnectionErrorView.tsx` | 1–91행 | 재시도 콜백/렌더 정상. 로그인 상태에 따른 차단 없음. |
| `src/lib/haptics.ts` | 1–36행 | 네이티브 진동 실패는 각 함수에서 처리한다. 시작 화면을 막는 미처리 rejection 발견 없음. |

## 확인된 동작과 영향

`AppLockGate.tsx:26–31, 83–86`은 웹 로그인 여부 또는 사용자 잠금 설정을 확인하지 않는다.
따라서 비로그인 iOS 사용자가 생체 인증을 취소하면 로그인 페이지가 로드되어도 볼 수 없다.
이는 크래시 재현이 아니라 기존 잠금 정책으로 인한 접근 차단이다.
기존 보호 기능을 없애면 로그인된 콘텐츠가 노출될 수 있으므로 이번 리뷰에서 잠금을 제거하지 않았다.
비로그인 화면만 공개하려면 세션 확인 방법, 세션 전환, 신뢰 가능한 브리지 메시지를 함께 설계해야 한다.

`AppLockGate.tsx:41`은 생체 인증 전에 ATT를 기다린다.
ATT가 진행 중이면 생체 인증도 기다리는 것을 테스트했다.
실제 OS의 Promise가 무한 대기했다는 증거는 없으며 현재 장애 원인이라고 단정할 수 없다.
단순 timeout으로 직렬 큐를 해제하면 아직 열려 있는 OS 권한 화면과 다음 화면이 겹칠 수 있다.

## 재현 테스트

`node --test tests/app-lock.test.cjs`

- Android 비로그인: 즉시 자식 렌더, 생체 인증 조회/요청 0회.
- iOS 비로그인 + 인증 취소: 자식 유지, 잠금 오버레이 및 재시도 버튼 유지.
- iOS 인증 성공: 기존 자식 유지, 잠금 오버레이 제거.
- iOS 하드웨어 조회 오류 또는 미등록: checking에 갇히지 않고 통과.
- ATT 대기/완료: 대기 중 생체 인증 0회, 완료 후 인증 및 잠금 해제.

이 테스트는 현재 정책을 명시하는 특성 테스트다. 취소 시 잠금 유지가 비로그인 UX의 권장 동작이라는 의미는 아니다.
