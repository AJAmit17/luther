import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import * as SecureStore from 'expo-secure-store';
import { TerminalView, type TerminalHandle } from '../../modules/luther-terminal';
import { del } from '@/lib/hosts';
import { useTerm } from '@/lib/socket';
import { Banner, useHex } from '@/components/ui';

const FONT_KEY = 'luther.termFont';
const savedFont = () => {
  const n = Number(SecureStore.getItem(FONT_KEY));
  return n >= 8 && n <= 24 ? n : 12;
};

// A shell in the project folder, as a real terminal: SwiftTerm renders the Mac's
// pty and owns the keyboard (its key bar has esc, ctrl, tab and arrows). On the
// Mac, `tmux -L luther attach -t <name>` shows the same shell.
export default function Terminal() {
  const { name, cwd } = useLocalSearchParams<{ name: string; cwd?: string }>();
  const view = useRef<TerminalHandle>(null);
  const queue = useRef<string[]>([]); // output that arrived before the view was ready
  const headerHeight = useHeaderHeight();
  const h = useHex();
  const [font, setFont] = useState(savedFont);
  const term = useTerm(name, (b64) => {
    if (view.current) void view.current.feed(b64);
    else queue.current.push(b64);
  });

  useEffect(() => {
    const t = setTimeout(() => {
      queue.current.splice(0).forEach((b) => void view.current?.feed(b));
      void view.current?.focus(); // keyboard up on arrival
    }, 250);
    return () => clearTimeout(t);
  }, []);

  const zoom = (d: number) =>
    setFont((f) => {
      const n = Math.max(8, Math.min(24, f + d));
      SecureStore.setItem(FONT_KEY, String(n));
      return n;
    });
  const kill = () =>
    Alert.alert('Close this terminal?', 'The shell and anything running in it stop.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Close', style: 'destructive', onPress: () => del('/terms/' + encodeURIComponent(name)).then(() => router.back(), (e) => Alert.alert('Error', e.message)) },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: cwd?.split('/').pop() || 'Terminal', headerStyle: { backgroundColor: h.bg } }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="keyboard" onPress={() => void view.current?.focus()} />
        <Stack.Toolbar.Menu icon="ellipsis">
          <Stack.Toolbar.MenuAction icon="textformat.size.larger" onPress={() => zoom(1)}>Larger text</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="textformat.size.smaller" onPress={() => zoom(-1)}>Smaller text</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="keyboard.chevron.compact.down" onPress={() => void view.current?.blur()}>Hide keyboard</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="xmark.circle" destructive onPress={kill}>Close terminal</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={{ flex: 1, backgroundColor: h.bg }}>
        {term.status === 'ended' && <Banner icon="stop.circle" text="This terminal has exited." />}
        {(term.status === 'connecting' || term.status === 'closed') && <Banner icon="arrow.triangle.2.circlepath" text={term.status === 'connecting' ? 'Connecting…' : 'Reconnecting…'} />}
        {!!term.error && <Banner error text={term.error} onPress={() => term.setError('')} />}
        <View style={{ flex: 1, paddingHorizontal: 4 }}>
          <TerminalView
            ref={view}
            style={{ flex: 1 }}
            fontSize={font}
            dark={h.dark}
            onInput={(e) => term.input(e.nativeEvent.data)}
            onResize={(e) => term.resize(e.nativeEvent.cols, e.nativeEvent.rows)}
          />
        </View>
      </KeyboardAvoidingView>
    </>
  );
}
