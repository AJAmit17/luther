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

function Item({ item }: { item: HeaderItem }) {
  return (
    <Stack.Toolbar.MenuAction icon={sf(item.icon)} isOn={item.on} destructive={item.destructive} disabled={item.disabled} onPress={item.onPress}>
      {item.title}
    </Stack.Toolbar.MenuAction>
  );
}

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
                  {entry.items.map((item, k) => <Item key={k} item={item} />)}
                </Stack.Toolbar.Menu>
              ) : (
                <Item key={j} item={entry} />
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
