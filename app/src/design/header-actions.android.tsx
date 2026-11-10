import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

/** What the actions look like, without their handlers: the header redraws only when this changes. */
const shape = (actions: HeaderAction[]) =>
  JSON.stringify(actions, (key, value) => (typeof value === 'function' ? undefined : value));

/** A screen's header buttons and menus. Android: the app's own buttons and menus, not Material's. */
export function HeaderActions({ actions }: { actions: HeaderAction[] }) {
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });
  const key = shape(actions);
  // One component for the screen's life: swapping it on every change makes the title re-lay out around an empty header.
  const shown = useRef<{ list: HeaderAction[]; set?: (l: HeaderAction[]) => void }>({ list: actions });
  useEffect(() => {
    shown.current.list = latest.current;
    shown.current.set?.(latest.current);
  }, [key]);
  const headerRight = useMemo(() => {
    const run = (i: number, j?: number) => {
      const a = latest.current[i];
      if (!a) return;
      if ('menu' in a) entries(a.menu)[j ?? -1]?.onPress();
      else a.onPress();
    };
    function Actions() {
      const [drawn, setDrawn] = useState(shown.current.list);
      useEffect(() => {
        shown.current.set = setDrawn;
        setDrawn(shown.current.list);
        return () => {
          shown.current.set = undefined;
        };
      }, []);
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
    // Navigation calls headerRight as a function, so the hooks need a component of their own.
    return function Right() {
      return <Actions />;
    };
  }, []);
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight });
    return () => navigation.setOptions({ headerRight: undefined });
  }, [navigation, headerRight]);
  return null;
}
