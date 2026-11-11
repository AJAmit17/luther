import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SectionHeader } from './heading';
import type { IconName } from './icons';
import { MenuView, RowMenu, type MenuAction, type Opener } from './menu';
import { Icon, Press, Surface, surfaceStyle } from './primitives';
import { Text } from './text';
import { useTheme } from './theme';
import { size, space } from './tokens';

export type ListItemProps = {
  title: string;
  mono?: boolean;
  subtitle?: string;
  subtitleLines?: number;
  leading?: ReactNode;
  icon?: IconName;
  iconColor?: string;
  value?: string;
  trailing?: ReactNode;
  selected?: boolean;
  destructive?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  menu?: MenuAction[];
  onMenu?: (id: string) => void;
  /** card: a standalone row; inset: a row inside a Group. */
  presentation?: 'card' | 'inset';
  first?: boolean;
};

export function ListItem({ title, mono, subtitle, subtitleLines = 1, leading, icon, iconColor, value, trailing, selected, destructive, onPress, onLongPress, menu, onMenu, presentation = 'card', first }: ListItemProps) {
  const { color } = useTheme();
  const inset = presentation === 'inset';
  const accessory =
    trailing ??
    (selected ? <Icon name="checkmark" size={16} color={color.accent} /> : inset && onPress && !destructive ? <Icon name="chevron.right" size={13} color={color.faint} /> : null);
  const content = (
    <>
      {leading ?? (icon ? <Icon name={icon} size={18} color={iconColor ?? (destructive ? color.red : color.text)} /> : null)}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant={mono ? 'subhead' : inset ? 'body' : 'callout'} mono={mono} weight={inset ? undefined : 'medium'} color={destructive ? 'red' : undefined} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text variant="footnote" numberOfLines={subtitleLines}>{subtitle}</Text>}
      </View>
      {!!value && <Text selectable numberOfLines={1} color="dim" style={{ flexShrink: 1, textAlign: 'right' }}>{value}</Text>}
      {accessory}
    </>
  );
  const row = { flexDirection: 'row', alignItems: 'center', gap: space.md } as const;
  const body = (open?: Opener) =>
    inset ? (
      <Press
        onPress={onPress}
        onLongPress={open ?? onLongPress}
        disabled={!onPress && !open && !onLongPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityState={selected ? { selected } : undefined}
        scale={1}
        style={[row, { paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: size.row, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth, borderTopColor: color.line }]}
      >
        {content}
      </Press>
    ) : (
      <Press onPress={onPress} onLongPress={open ?? onLongPress} accessibilityRole={onPress ? 'button' : undefined} style={[surfaceStyle(color), row, { paddingHorizontal: space.md + 2, paddingVertical: space.md + 1 }]}>
        {content}
      </Press>
    );
  if (!menu) return body();
  return <RowMenu actions={menu} onPick={(id) => onMenu?.(id)}>{body}</RowMenu>;
}

export type MenuChoice = MenuAction & { subtitle?: string };

/** A Group row that opens a menu of choices when tapped. */
export function MenuRow({ actions, onPick, ...item }: ListItemProps & { actions: MenuChoice[]; onPick: (id: string) => void }) {
  const { color, scheme } = useTheme();
  return (
    <MenuView colorScheme={scheme} actions={actions} onPressAction={({ nativeEvent }) => onPick(nativeEvent.event)}>
      <ListItem trailing={<Icon name="chevron.up.chevron.down" size={13} color={color.faint} />} presentation="inset" {...item} />
    </MenuView>
  );
}

const isRow = (child: unknown): child is ReactElement<ListItemProps> => isValidElement(child) && (child.type === ListItem || child.type === MenuRow);

/** Settings-style rows in one card, with a header above and a footer below. ListItems and MenuRows inside become inset rows; anything else is drawn as is. */
export function Group({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const items = Children.toArray(children);
  const firstRow = items.find(isRow);
  return (
    <View style={{ gap: space.xs + 2 }}>
      {!!title && <SectionHeader title={title} />}
      <Surface style={{ overflow: 'hidden' }}>
        {items.map((child) => (isRow(child) ? cloneElement(child, { first: child === firstRow, presentation: 'inset' }) : child))}
      </Surface>
      {!!footer && <Text variant="footnote" style={{ paddingHorizontal: space.lg }}>{footer}</Text>}
    </View>
  );
}
