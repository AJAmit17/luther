import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { applyTheme, type Scheme } from '@/components/ui';

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

// The scheme in effect. Worked out here rather than read back from Appearance:
// on Android the override lands asynchronously, so a read right after setting
// it can still report the old scheme.
const effective = (system = Appearance.getColorScheme()): Scheme => (choice === 'system' ? (system === 'light' ? 'light' : 'dark') : choice);

// The choice also goes to the OS as the app's interface style, so native views
// (headers, tab bar, alerts, the keyboard) follow it.
const apply = () => {
  Appearance.setColorScheme(choice === 'system' ? 'unspecified' : choice);
  applyTheme(effective());
};
apply(); // before the first render: no flash of the other scheme
Appearance.addChangeListener(({ colorScheme }) => {
  if (choice === 'system') applyTheme(effective(colorScheme));
});

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
