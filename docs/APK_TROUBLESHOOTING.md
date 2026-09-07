# APK 시작 종료 진단

`preview`는 EAS의 `preview` 환경변수를 사용한다. 운영 변수를 별도로 복사하지 않은 상태에서 빌드하면 카카오/Firebase/오퍼월 설정이 운영 앱과 달라질 수 있다.

운영 환경변수를 사용해 설치용 APK를 만들 때는 다음 명령을 사용한다.

```bash
npx eas-cli@latest build --platform android --profile apk
```

`apk`는 production 빌드 설정과 환경변수를 사용하고 결과물만 APK로 바꾼다. 업데이트 채널은 `apk`로 분리해 기존 preview 채널의 OTA를 받지 않는다.

원격 EAS 빌드에서 `KAKAO_NATIVE_APP_KEY`가 비었거나 Android AdMob 앱 ID 형식이 잘못되면 빌드를 중단한다. 앱 ID는 `~`가 들어가며 `/`가 들어가는 광고 단위 ID와 다르다. 오류 메시지에 키 값은 출력하지 않는다.

이 검사는 잘못된 설정을 가진 APK 생성을 막는 조치이며, 보고된 앱 종료의 원인이 확정됐다는 의미는 아니다. 현재 설치된 APK의 크래시 로그가 있어야 원인을 확정할 수 있다.

Android SDK Platform Tools가 설치된 PC에 USB 디버깅을 허용한 휴대폰을 연결한다. 앱을 실행해 종료되는 현상을 재현한 직후 다음 명령으로 로그를 저장한다.

```bash
adb logcat -b crash -d -v threadtime > shoppinglog-crash.txt
```

`FATAL EXCEPTION`/`Caused by` 또는 네이티브 시그널 부분과 프로세스 이름 `store.shoppinglog.app`을 확인한다. 로그에는 기기 정보 등이 포함될 수 있으므로 공개 이슈에 전체 로그를 게시하지 않는다.

크래시 로그가 없으면 종료 현상이 프로세스 크래시인지, 웹뷰 오류 화면인지부터 구분한다. 설치한 APK 또는 EAS 빌드 링크는 빌드 프로필·커밋·포함된 네이티브 설정을 확인하는 데 도움이 된다.
