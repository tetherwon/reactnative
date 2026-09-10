import { AppState } from 'react-native';

// Serialize ATT, notification permissions and biometrics across the entire app.
let tail: Promise<unknown> = Promise.resolve();

export async function waitForActive(): Promise<void> {
  if (AppState.currentState === 'active') return;
  await new Promise<void>((resolve) => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') { sub.remove(); resolve(); }
    });
    if (AppState.currentState === 'active') { sub.remove(); resolve(); }
  });
}

export async function waitForStableActive(): Promise<void> {
  do {
    await waitForActive();
    await new Promise<void>((resolve) => setTimeout(resolve, 350));
  } while (AppState.currentState !== 'active');
}

export function withNativePrompt<T>(action: () => Promise<T>): Promise<T> {
  const result = tail.then(async () => {
    await waitForStableActive();
    return action();
  });
  tail = result.catch(() => undefined);
  return result;
}
