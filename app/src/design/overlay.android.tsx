import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View, type PressableProps, type ViewStyle } from 'react-native';
import { useTheme } from './theme';
import { radius, shadow } from './tokens';

/** Keep it mounted and flip `open`, so the Modal can fade it out. */
export function Overlay({ open, onClose, onScrim, children }: { open: boolean; onClose: () => void; onScrim?: () => void; children: ReactNode }) {
  const { color } = useTheme();
  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: color.scrim }]} onPress={onScrim} disabled={!onScrim} accessibilityLabel={onScrim ? 'Close' : undefined} />
      {children}
    </Modal>
  );
}

export function Card({ style, children, role }: { style?: ViewStyle; children: ReactNode; role?: 'menu' | 'alert' }) {
  const { color, dark } = useTheme();
  return (
    <View
      accessibilityRole={role}
      style={[{ borderRadius: radius.card, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: color.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line }, !dark && { boxShadow: shadow.raised }, style]}
    >
      {children}
    </View>
  );
}

export function CardRow({ first, style, ...p }: PressableProps & { first?: boolean; style?: ViewStyle }) {
  const { color } = useTheme();
  return <Pressable {...p} style={({ pressed }) => [{ borderTopWidth: first ? 0 : 1, borderTopColor: color.line, backgroundColor: pressed ? color.muted : 'transparent' }, style]} />;
}
