import type { TextStyle } from 'react-native';
import { Easing } from 'react-native-reanimated';

/** Text is the system face (SF Pro on iOS, Roboto on Android); code is Geist Mono. */
export const font = { mono: 'Geist Mono' } as const;

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { control: 8, card: 12, sheet: 16, full: 999 } as const;

export const size = { hit: 44, row: 48, control: 34, tile: 36 } as const;

export const motion = {
  press: 150,
  state: 180,
  pulse: 800,
  follow: 90,
  glide: { duration: 220, easing: Easing.out(Easing.cubic) },
} as const;

export const type = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '600' },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22 },
  callout: { fontSize: 16, lineHeight: 21 },
  subhead: { fontSize: 15, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 },
  caption2: { fontSize: 11, lineHeight: 14 },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

export const shadow = {
  raised: '0 10px 30px rgba(0,0,0,0.12)',
  thumb: '0 1px 3px rgba(0,0,0,0.12)',
  knob: '0 2px 6px rgba(0,0,0,0.25)',
  accent:
    'inset 0 -6px 12px 0 rgba(255,0,0,0.2), 0 1px 2px 0 rgba(255,139,0,0.22), 0 3px 6px 0 rgba(255,139,0,0.16), 0 2px 4px 0 rgba(250,93,25,0.3)',
} as const;
