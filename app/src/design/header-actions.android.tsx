import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { useNavigation } from 'expo-router';
import { Button, IconButton } from './button';
import { Spinner } from './feedback';
import type { HeaderAction, HeaderItem, HeaderSection } from './header-actions';
import { MenuView, type MenuAction } from './menu';
import { space } from './tokens';

export type { HeaderAction, HeaderItem, HeaderSection };

const entries = (menu: (HeaderItem | HeaderSection)[]) => menu.flatMap((e) => ('section' in e ? e.items : [e]));

const toMenu = (menu: (HeaderItem | HeaderSection)[]): MenuAction[] =>
  entries(menu).map((item, i) => ({ id: String(i), title: item.title, image: item.icon, state: item.on ? 'on' : 'off', attributes: { destructive: item.destructive, disabled: item.disabled } }));

/** What the actions look like, without their handlers: the header is rebuilt only when this changes. */
const shape = (actions: HeaderAction[]) =>
  JSON.stringify(actions, (key, value) => (typeof value === 'function' ? undefined : value));

/** A screen's header buttons and menus. Android: the app's own buttons and menus, not Material's. */
export function HeaderActions({ actions }: { actions: HeaderAction[] }) {
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });
  const key = shape(actions);
  const headerRight = useMemo(() => {
    const drawn = JSON.parse(key) as HeaderAction[];
    const run = (i: number, j?: number) => {
      const a = latest.current[i];
      if (!a) return;
      if ('menu' in a) entries(a.menu)[j ?? -1]?.onPress();
      else a.onPress();
    };
    function Actions() {
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          {drawn.map((a, i) =>
            'menu' in a ? (
              <MenuView key={i} actions={toMenu(a.menu)} accessibilityLabel={a.label} onPressAction={({ nativeEvent }) => run(i, Number(nativeEvent.event))}>
                <View pointerEvents="none">
                  <IconButton icon={a.icon} label={a.label} size={40} onPress={() => {}} />
                </View>
              </MenuView>
            ) : 'text' in a ? (
              a.busy ? <Spinner key={i} /> : <Button key={i} size="sm" variant={a.prominent ? 'primary' : 'tertiary'} label={a.text} disabled={a.disabled} onPress={() => run(i)} />
            ) : (
              <IconButton key={i} icon={a.icon} label={a.label} size={40} disabled={a.disabled} onPress={() => run(i)} />
            ),
          )}
        </View>
      );
    }
    return Actions;
  }, [key]);
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight });
    return () => navigation.setOptions({ headerRight: undefined });
  }, [navigation, headerRight]);
  return null;
}
