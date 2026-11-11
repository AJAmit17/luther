import { useSyncExternalStore } from 'react';
import { Appearance as System } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { PALETTE } from '@/lib/palette';

export type Scheme = 'light' | 'dark';
export type Appearance = 'system' | Scheme;
export type ColorName = keyof typeof PALETTE;
export type Palette = Record<ColorName, string>;
export type Theme = { scheme: Scheme; dark: boolean; color: Palette };

const pick = (i: 0 | 1) => Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, v[i]])) as Palette;

export const palettes: Record<Scheme, Palette> = { light: pick(0), dark: pick(1) };

const THEMES: Record<Scheme, Theme> = {
  light: { scheme: 'light', dark: false, color: palettes.light },
  dark: { scheme: 'dark', dark: true, color: palettes.dark },
};

/** A colour at an opacity, as 8-digit hex. */
export const tint = (hex: string, alpha: number) => hex.slice(0, 7) + Math.round(alpha * 255).toString(16).padStart(2, '0');

const KEY = 'luther.appearance';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const saved = (): Appearance => {
  try {
    const v = SecureStore.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
};

let appearance = saved();
// Worked out here, not read back from the system: on Android an override lands asynchronously.
const resolve = (system = System.getColorScheme()): Scheme => (appearance === 'system' ? (system === 'light' ? 'light' : 'dark') : appearance);
let theme = THEMES[resolve()];

const apply = (scheme: Scheme) => {
  if (theme.scheme === scheme) return;
  theme = THEMES[scheme];
  notify();
};

System.setColorScheme(appearance === 'system' ? 'unspecified' : appearance);
System.addChangeListener(({ colorScheme }) => appearance === 'system' && apply(resolve(colorScheme)));

export function setAppearance(next: Appearance) {
  appearance = next;
  try {
    SecureStore.setItem(KEY, next);
  } catch {}
  System.setColorScheme(next === 'system' ? 'unspecified' : next);
  theme = THEMES[resolve()];
  notify();
}

const getTheme = () => theme;
export const useTheme = () => useSyncExternalStore(subscribe, getTheme);
export const useAppearance = () => useSyncExternalStore(subscribe, () => appearance);

export type Tone = 'neutral' | 'accent' | 'success' | 'info' | 'warning' | 'danger';
export const TONE: Record<Tone, ColorName> = { neutral: 'text', accent: 'accent', success: 'green', info: 'blue', warning: 'warn', danger: 'red' };
