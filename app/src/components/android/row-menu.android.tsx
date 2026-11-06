import { useState, type ReactNode } from 'react';
import { Host } from '@expo/ui';
import { ListItem, ModalBottomSheet, Text } from '@expo/ui/jetpack-compose';
import { clickable } from '@expo/ui/jetpack-compose/modifiers';
import type { MenuAction } from '@expo/ui/community/menu';
import { c, useHex } from '@/components/ui';

/** A row's long-press menu on Android: Material's bottom sheet of actions.
 *  `children` gets the function that opens it, for the row's onLongPress. */
export function RowMenu({ actions, onPick, children }: { actions: MenuAction[]; onPick: (id: string) => void; children: (open?: () => void) => ReactNode }) {
  const h = useHex();
  const [open, setOpen] = useState(false);
  const pick = (id: string) => {
    setOpen(false);
    onPick(id);
  };
  return (
    <>
      {children(() => setOpen(true))}
      {open && (
        <Host matchContents style={{ position: 'absolute' }} colorScheme={h.dark ? 'dark' : 'light'} seedColor={c.accent}>
          <ModalBottomSheet onDismissRequest={() => setOpen(false)} skipPartiallyExpanded containerColor={c.card}>
            {actions.map((a) => {
              const id = a.id ?? a.title;
              return (
                <ListItem key={id} colors={{ containerColor: c.card }} modifiers={a.attributes?.disabled ? [] : [clickable(() => pick(id))]}>
                  <ListItem.HeadlineContent>
                    <Text color={a.attributes?.destructive ? c.red : a.attributes?.disabled ? c.faint : c.text} style={{ typography: 'bodyLarge', fontWeight: a.state === 'on' ? '600' : 'normal' }}>
                      {a.state === 'on' ? `✓  ${a.title}` : a.title}
                    </Text>
                  </ListItem.HeadlineContent>
                </ListItem>
              );
            })}
          </ModalBottomSheet>
        </Host>
      )}
    </>
  );
}
