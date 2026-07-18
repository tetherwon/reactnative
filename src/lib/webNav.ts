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

// 네이티브 화면에서 잔액이 바뀌는 행동(룰렛 스핀·출석 등)을 하면 표시해두고,
// 웹뷰로 돌아갈 때 웹 캐시(sl_me_cache 등)를 무효화해 상단 캐시·티켓 표시를 맞춘다.
let webStateDirty = false;

export function markWebStateDirty(): void {
  webStateDirty = true;
}

export function consumeWebStateDirty(): boolean {
  const dirty = webStateDirty;
  webStateDirty = false;
  return dirty;
}

// 웹뷰에서 실행할 커맨드 (현재는 'logout' 하나): 네이티브 로그아웃 시 웹뷰의
// 쿠키 세션·로컬 캐시도 함께 정리해야 두 세계의 로그인 상태가 일치한다.
let webCommand: string | null = null;

export function requestWebCommand(cmd: 'logout'): void {
  webCommand = cmd;
}

export function consumeWebCommand(): string | null {
  const c = webCommand;
  webCommand = null;
  return c;
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
