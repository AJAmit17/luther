import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { IconButton } from './button';
import { Text } from './text';
import { useTheme } from './theme';
import { radius, space } from './tokens';

/** A bottom sheet over the current screen, for settings that belong to it. */
export function Sheet({ open, onClose, title, leading, children }: { open: boolean; onClose: () => void; title: string; leading?: ReactNode; children: ReactNode }) {
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: color.scrim }} onPress={onClose} accessibilityLabel="Close" />
        <View style={{ maxHeight: '85%', backgroundColor: color.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderCurve: 'continuous' }}>
          <View style={{ alignItems: 'center', paddingTop: space.sm }}>
            <View style={{ width: 38, height: 5, borderRadius: 3, backgroundColor: color.line }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 10, gap: space.lg + 2, paddingBottom: space.lg + insets.bottom }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {leading}
              <Text variant="title3" style={{ flex: 1 }}>
                {title}
              </Text>
              <IconButton icon="xmark" label="Close" variant="tinted" size={32} onPress={onClose} />
            </View>
            {children}
          </ScrollView>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** A form sheet route's title row, with its close button. */
export function SheetHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
      <View style={{ flex: 1, gap: space.xxs }}>
        <Text variant="title2" accessibilityRole="header">
          {title}
        </Text>
        {!!subtitle && (
          <Text selectable variant="footnote" numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      <IconButton icon="xmark" label="Close" variant="tinted" size={32} onPress={() => router.back()} />
    </View>
  );
}

/** A form sheet route's actions, pinned under its scrolling content. */
export function SheetFooter({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  // Android's form sheet sits under the navigation bar even when the inset reads 0.
  const bottom = Math.max(insets.bottom, process.env.EXPO_OS === 'android' ? 48 : 0);
  return (
    <KeyboardStickyView offset={{ opened: bottom }}>
      <View style={{ flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg + space.xs, paddingTop: space.md, paddingBottom: space.md + bottom }}>{children}</View>
    </KeyboardStickyView>
  );
}
