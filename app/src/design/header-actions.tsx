import { Stack } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { Spinner } from './feedback';
import type { IconName } from './icons';

export type HeaderItem = { title: string; icon?: IconName; onPress: () => void; destructive?: boolean; disabled?: boolean; on?: boolean };
export type HeaderSection = { section: string; items: HeaderItem[] };
export type HeaderAction =
  | { icon: IconName; label: string; onPress: () => void; disabled?: boolean }
  | { text: string; onPress: () => void; disabled?: boolean; busy?: boolean; prominent?: boolean }
  | { icon: IconName; label: string; menu: (HeaderItem | HeaderSection)[] };

const sf = (name?: IconName) => name as SFSymbol | undefined;

// The toolbar reads its children by type, so items must be MenuAction elements, not components wrapping them.
const item = (it: HeaderItem, key: number) => (
  <Stack.Toolbar.MenuAction key={key} icon={sf(it.icon)} isOn={it.on} destructive={it.destructive} disabled={it.disabled} onPress={it.onPress}>
    {it.title}
  </Stack.Toolbar.MenuAction>
);

/** A screen's header buttons and menus. iOS: the native toolbar. */
export function HeaderActions({ actions }: { actions: HeaderAction[] }) {
  return (
    <Stack.Toolbar placement="right">
      {actions.map((a, i) =>
        'menu' in a ? (
          <Stack.Toolbar.Menu key={i} icon={sf(a.icon)} accessibilityLabel={a.label}>
            {a.menu.map((entry, j) =>
              'section' in entry ? (
                <Stack.Toolbar.Menu key={j} inline title={entry.section}>
                  {entry.items.map(item)}
                </Stack.Toolbar.Menu>
              ) : (
                item(entry, j)
              ),
            )}
          </Stack.Toolbar.Menu>
        ) : 'text' in a ? (
          a.busy ? (
            <Stack.Toolbar.View key={i}>
              <Spinner />
            </Stack.Toolbar.View>
          ) : (
            <Stack.Toolbar.Button key={i} variant={a.prominent ? 'done' : 'plain'} disabled={a.disabled} onPress={a.onPress}>{a.text}</Stack.Toolbar.Button>
          )
        ) : (
          <Stack.Toolbar.Button key={i} icon={sf(a.icon)} accessibilityLabel={a.label} disabled={a.disabled} onPress={a.onPress} />
        ),
      )}
    </Stack.Toolbar>
  );
}
