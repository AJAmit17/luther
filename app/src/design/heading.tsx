import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from './text';
import { space } from './tokens';

const ios = process.env.EXPO_OS === 'ios';

export function SectionHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    <View accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs, paddingTop: space.lg, paddingBottom: space.xs + 2 }}>
      <Text variant="footnote" weight="medium" style={{ flex: 1, textTransform: 'uppercase', letterSpacing: 0.4 }}>{title}</Text>
      {trailing}
    </View>
  );
}

/** A tab's title on Android, at iOS's large-title size (iOS's header draws its own). */
export function LargeTitle({ children }: { children: string }) {
  if (ios) return null;
  return <Text variant="largeTitle" numberOfLines={1} accessibilityRole="header" style={{ paddingHorizontal: space.xs, paddingBottom: space.xs + 2 }}>{children}</Text>;
}
