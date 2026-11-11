import type { ReactNode } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { MenuView as NativeMenu, type MenuAction, type MenuComponentProps } from '@expo/ui/community/menu';

export type { MenuAction };

/** A long press, with where it landed (Android places its menu there). */
export type Opener = (e: GestureResponderEvent) => void;

export type MenuProps = MenuComponentProps & { accessibilityLabel?: string };

export const MenuView = ({ accessibilityLabel: _, ...p }: MenuProps) => <NativeMenu {...p} />;

export function RowMenu({ actions, onPick, children }: { actions: MenuAction[]; onPick: (id: string) => void; children: (open?: Opener) => ReactNode }) {
  return (
    <NativeMenu actions={actions} shouldOpenOnLongPress onPressAction={({ nativeEvent }) => onPick(nativeEvent.event)}>
      {children()}
    </NativeMenu>
  );
}
