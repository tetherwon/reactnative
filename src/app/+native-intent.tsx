// 소셜 로그인 콜백 딥링크(webview://auth?token=...&new=...) 라우팅 처리.
//
// 정상 흐름에서는 index.tsx 의 WebBrowser.openAuthSessionAsync 가 이 딥링크를
// 받아 토큰을 처리하지만, 로그인 도중 안드로이드가 메모리 부족 등으로 앱
// 프로세스를 죽였거나 인증 세션 밖의 브라우저에서 로그인이 진행된 경우에는
// 딥링크가 Expo Router 로 직접 들어온다. 이 앱에는 /auth 라우트가 없으므로
// 그대로 두면 "Unmatched Route" 화면이 뜨고 토큰이 버려진다.
// 홈(index) 라우트로 돌려보내되 쿼리(token, new)는 유지해서 index.tsx 가
// 웹뷰에 토큰을 전달하게 한다.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (/^webview:\/\/auth([/?#]|$)/i.test(path)) {
    const queryIndex = path.indexOf('?');
    return queryIndex >= 0 ? `/${path.slice(queryIndex)}` : '/';
  }
  return path;
}
