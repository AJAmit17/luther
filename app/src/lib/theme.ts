import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/** Settings → Appearance: the phone's setting, or always light, or always dark.
 *  Applied to the whole app (native headers, tab bar, keyboard, alerts too). */
export type Choice = 'system' | 'light' | 'dark';

const KEY = 'luther.appearance';
let choice: Choice = (() => {
  try {
    const v = SecureStore.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
})();
const listeners = new Set<() => void>();

const apply = () => Appearance.setColorScheme(choice === 'system' ? 'auto' : choice);
apply(); // before the first render: no flash of the other scheme

export function setAppearance(next: Choice) {
  choice = next;
  try {
    SecureStore.setItem(KEY, next);
  } catch {
    // remembered for this run
  }
  apply();
  listeners.forEach((fn) => fn());
}

export function useAppearance(): Choice {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => choice,
  );
}
