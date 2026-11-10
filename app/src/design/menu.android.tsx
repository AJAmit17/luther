import { useRef, useState, type ReactNode } from 'react';
import { Pressable, View, useWindowDimensions, type HostInstance } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { MenuAction, MenuProps, Opener } from './menu';
import { Card, CardRow, Overlay } from './overlay.android';
import { Icon } from './primitives';
import { Text } from './text';
import { useTheme } from './theme';
import { space } from './tokens';
import type { IconName } from './icons';

export type { MenuAction, MenuProps, Opener };

type Anchor = { x: number; y: number; w: number; h: number };
type Item = MenuAction & { subtitle?: string };

const WIDTH = 250;
const ROW = 46;

function Popover({ open, actions, title, anchor, onPick, onClose }: { open: boolean; actions: Item[]; title?: string; anchor: Anchor | null; onPick: (id: string) => void; onClose: () => void }) {
  const { color } = useTheme();
  const win = useWindowDimensions();
  if (!anchor) return null;
  const items = actions.flatMap((a) => (a.subactions?.length ? a.subactions : [a])).filter((a) => !a.attributes?.hidden) as Item[];
  const checks = items.some((a) => a.state === 'on');
  const height = (title ? 34 : 0) + items.reduce((n, a) => n + (a.subtitle ? ROW + 14 : ROW) + 1, 0);
  const left = Math.min(Math.max(space.md, anchor.x), win.width - WIDTH - space.md);
  const below = anchor.y + anchor.h + 6;
  const top = below + height < win.height - 40 ? below : Math.max(48, anchor.y - height - 6);
  return (
    <Overlay open={open} onClose={onClose} onScrim={onClose}>
      <Card role="menu" style={{ position: 'absolute', left, top, width: WIDTH }}>
        {!!title && <Text variant="footnote" style={{ paddingHorizontal: space.lg, paddingTop: 10, paddingBottom: 6 }}>{title}</Text>}
        {items.map((a, i) => {
          const id = a.id ?? a.title;
          const off = a.attributes?.disabled;
          const hue = a.attributes?.destructive ? color.red : off ? color.faint : color.text;
          return (
            <CardRow
              key={id}
              first={!i && !title}
              disabled={off}
              accessibilityRole="menuitem"
              accessibilityState={{ checked: a.state === 'on', disabled: off }}
              onPress={() => {
                void Haptics.selectionAsync();
                onClose();
                onPick(id);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: a.subtitle ? ROW + 14 : ROW, paddingHorizontal: space.lg }}
            >
              {checks && <View style={{ width: 16 }}>{a.state === 'on' && <Icon name="checkmark" size={15} color={color.text} />}</View>}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: hue }}>{a.title}</Text>
                {!!a.subtitle && <Text variant="caption" numberOfLines={1}>{a.subtitle}</Text>}
              </View>
              {typeof a.image === 'string' && <Icon name={a.image as IconName} size={18} color={hue} />}
            </CardRow>
          );
        })}
      </Card>
    </Overlay>
  );
}

export function MenuView({ actions, title, onPressAction, shouldOpenOnLongPress, style, children, accessibilityLabel }: MenuProps) {
  const ref = useRef<HostInstance>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [open, setOpen] = useState(false);
  const show = () =>
    ref.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ x, y, w, h });
      setOpen(true);
    });
  return (
    <>
      <Pressable ref={ref} style={style} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} onPress={shouldOpenOnLongPress ? undefined : show} onLongPress={shouldOpenOnLongPress ? show : undefined}>
        {children}
      </Pressable>
      <Popover open={open} actions={actions} title={title} anchor={anchor} onClose={() => setOpen(false)} onPick={(id) => onPressAction?.({ nativeEvent: { event: id } })} />
    </>
  );
}

export function RowMenu({ actions, onPick, children }: { actions: MenuAction[]; onPick: (id: string) => void; children: (open?: Opener) => ReactNode }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      {children((e) => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setAnchor({ x: e.nativeEvent.pageX - WIDTH / 2, y: e.nativeEvent.pageY, w: 0, h: 0 });
        setOpen(true);
      })}
      <Popover open={open} actions={actions} anchor={anchor} onClose={() => setOpen(false)} onPick={onPick} />
    </>
  );
}
