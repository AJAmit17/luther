import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { IconName } from './icons';
import { Icon } from './primitives';
import { useTheme } from './theme';
import { size as sizes } from './tokens';

/** A rounded square holding an icon or a mark: list leadings, agent tiles. */
export function Tile({ icon, color, size = sizes.tile, children }: { icon?: IconName; color?: string; size?: number; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, borderCurve: 'continuous', backgroundColor: theme.color.muted, alignItems: 'center', justifyContent: 'center' }}>
      {children ?? (icon ? <Icon name={icon} size={size * 0.5} color={color} /> : null)}
    </View>
  );
}
