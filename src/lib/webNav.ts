// 네이티브 화면 → 웹뷰 페이지 이동 요청 버스.
// router 파라미터로 전달하면 인덱스(웹뷰) 화면이 리마운트되어 웹뷰가 처음부터
// 다시 로드되는 문제가 있어(앱 재시작처럼 보임), 마운트된 웹뷰를 그대로 두고
// 이벤트로 목적지만 넘긴다. 호출측은 requestWebNav(path) 후 router.dismissTo('/')로
// 네이티브 스택만 걷어낸다.

let pending: string | null = null;
let listener: ((path: string) => void) | null = null;

export function requestWebNav(path: string): void {
  if (!path.startsWith('/')) return;
  if (listener) listener(path);
  else pending = path;
}

export function setWebNavListener(fn: (path: string) => void): () => void {
  listener = fn;
  if (pending) {
    const p = pending;
    pending = null;
    fn(p);
  }
  return () => {
    if (listener === fn) listener = null;
  };
}
