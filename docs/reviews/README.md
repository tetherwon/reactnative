# 비로그인 시작 장애 리뷰 — 2026-09-11

4개 담당 에이전트가 시작/잠금, WebView/인증, 네이티브/설정, 서버/게스트 화면을 나누어 검토했다.
앱 main `485cd100`과 미병합 PR #10의 분리 코드를 비교했다. PR #10은 현재 배포 코드가 아니다.

## 상세 검토

- [시작·생체 인증·권한 큐](startup-review.md)
- [WebView·인증·링크·로딩 복구](webview-review.md)
- [네이티브 SDK·브리지·빌드 설정](native-review.md)
- 서버의 `docs/reviews/guest-startup-review.md`: 홈/로그인 라우트, 세션 응답, 템플릿, 웹 초기화·캐시.

## 통합 판단

비로그인 WebView 화면은 토큰 없이 홈 URL을 렌더한다. 하지만 iOS는 별도 AppLockGate가 전체를 덮으므로
생체 인증 취소 시 로그인 화면도 볼 수 없다. 기존 보안 정책을 제거하는 수정은 하지 않았다.
실제 사용자 기기의 앱 프로세스 종료는 재현하지 못했으며, 이번 수정으로 종료 문제가 해결됐다고 주장하지 않는다.

재현 가능한 WebView 실패 후 준비 상태/오류 복구, 잘못된 브리지 메시지 처리, 키가 없는 EAS 네이티브 빌드,
서버의 만료된 세션 캐시와 로그인 버튼 문제를 수정했다. 상세한 증거와 검증 한계는 각 보고서에 있다.

## 추가 파일 검토

| 파일 | 결과 |
| --- | --- |
| `.github/workflows/eas-update.yml` | 기존 main 자동 OTA 앞에 검증 단계가 없었다. PR/main에서 테스트·타입 검사·린트를 실행하고 성공 후에만 OTA를 진행하도록 추가했다. |
| `package.json`, `package-lock.json` | Expo 56, RN 0.85, React 19.2 조합 확인. 설치된 패키지로 양 플랫폼 Metro/Hermes export가 성공했다. 바이너리 실행 검증과는 다르다. |
| `tsconfig.json`, `eslint.config.js` | strict 및 @ alias, 소스 검사 범위 확인. 초기 실행 차단 근거 없음. |
| `eas.json` (원격 main) | apk는 production 환경/채널을 상속한다. 사용자 설치 파일이 어느 빌드인지 아직 확인되지 않았다. |
| `scripts/reset-project.js` | package start/native build/OTA 경로에서 호출되지 않는다. 실행 장애 원인 범위에서 제외했다. |

## 실기기에서 남은 확인

Android/iOS 종류, 설치 버전·빌드 번호, 종료인지 로고/잠금/흰 화면 정지인지가 필요하다.
Android 즉시 종료는 `adb logcat -b crash -d` 결과로 예외와 스택을 확인한다.
iOS는 Xcode Devices and Simulators의 해당 앱 crash log가 필요하다. 로그를 공유할 때 토큰·사용자 정보는 지운다.

필수 시나리오: 앱 데이터가 없는 첫 실행, 생체 인증 승인/취소, 만료된 세션 재진입,
오프라인 시작→연결 복구→재시도, HTTP 실패 후 재시도, WebView renderer 종료 후 재시도.
현재 Node 테스트는 native/React API를 mock한 회귀 테스트이며 실기기 화면·SDK 검증을 대신하지 않는다.
