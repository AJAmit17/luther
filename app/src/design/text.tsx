import type { ComponentPropsWithRef } from 'react';
import { Text as RNText, TextInput as RNTextInput } from 'react-native';
import { useTheme, type ColorName } from './theme';
import { font, type as scale, type TypeVariant } from './tokens';

const QUIET = new Set<TypeVariant>(['footnote', 'caption', 'caption2']);
const MAX_SCALE = 1.6;

type Look = { color?: ColorName; weight?: 'regular' | 'medium'; mono?: boolean };
export type TextProps = Omit<ComponentPropsWithRef<typeof RNText>, 'color'> & Look & { variant?: TypeVariant };

const weightOf = (w?: Look['weight']) => (w ? { fontWeight: w === 'medium' ? '500' : '400' } as const : undefined);

export function Text({ variant = 'body', color: name, weight, mono, style, ...p }: TextProps) {
  const { color } = useTheme();
  return (
    <RNText
      maxFontSizeMultiplier={MAX_SCALE}
      {...p}
      style={[scale[variant], mono && { fontFamily: font.mono }, { color: color[name ?? (QUIET.has(variant) ? 'dim' : 'text')] }, weightOf(weight), style]}
    />
  );
}

/** Inline text inside a Text: inherits size and colour unless told otherwise. */
export function Span({ color: name, weight, mono, style, ...p }: Omit<ComponentPropsWithRef<typeof RNText>, 'color'> & Look) {
  const { color } = useTheme();
  return <RNText {...p} style={[mono && { fontFamily: font.mono }, name && { color: color[name] }, weightOf(weight), style]} />;
}

export function TextInput({ style, mono, ...p }: ComponentPropsWithRef<typeof RNTextInput> & { mono?: boolean }) {
  const { color } = useTheme();
  return (
    <RNTextInput
      maxFontSizeMultiplier={MAX_SCALE}
      placeholderTextColor={color.faint}
      selectionColor={color.accent}
      {...p}
      style={[scale.body, mono && { fontFamily: font.mono }, { color: color.text }, style]}
    />
  );
}
