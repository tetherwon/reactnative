// Only forward an authorization code and state; never accept bearer tokens from a link.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    const url = new URL(path);
    if (url.protocol === 'webview:' && url.hostname === 'auth') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (code && state) return '/?code=' + encodeURIComponent(code) + '&state=' + encodeURIComponent(state);
      return '/';
    }
    return path;
  } catch { return '/'; }
}
