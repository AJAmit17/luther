import type { ReactNode } from 'react';
import { MenuView, type MenuAction } from '@expo/ui/community/menu';

/** A row's long-press menu on iOS: the native context menu around the row. */
export function RowMenu({ actions, onPick, children }: { actions: MenuAction[]; onPick: (id: string) => void; children: (open?: () => void) => ReactNode }) {
  return (
    <MenuView actions={actions} shouldOpenOnLongPress onPressAction={({ nativeEvent }) => onPick(nativeEvent.event)}>
      {children()}
    </MenuView>
  );
}
