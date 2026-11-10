import { useRef, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View, type ScrollViewInstance } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner, Press, Text, TextInput, palettes, radius, space, type as scale } from '@/design';
import { AnsiText } from '@/components/ansi';
import { useTerm } from '@/lib/socket';

const FS = 11;
const KEYS: [string, string][] = [
  ['esc', '\x1b'], ['tab', '\t'], ['⇧tab', '\x1b[Z'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C'], ['⏎', '\r'], ['^C', '\x03'], ['^D', '\x04'],
];
// A terminal is dark in both schemes.
const ink = palettes.dark;

// A shell in the project folder (on the Mac: `tmux -L luther attach -t <name>`).
// Not an emulator: the pane's rendered ANSI, a key bar with sticky Ctrl, a line input.
export default function Terminal() {
  const { name, cwd } = useLocalSearchParams<{ name: string; cwd?: string }>();
  const term = useTerm(name);
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const [ctrl, setCtrl] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);

  const submit = () => {
    if (ctrl && draft.length === 1) term.input(String.fromCharCode(draft.toUpperCase().charCodeAt(0) & 0x1f)); // Ctrl+letter
    else term.input(draft + '\r');
    setCtrl(false);
    setDraft('');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: ink.bg }} behavior="padding" keyboardVerticalOffset={insets.top + 44}>
      <Stack.Screen
        options={{
          title: `Terminal · ${cwd?.split('/').pop() || name}`,
          headerStyle: { backgroundColor: ink.bg },
          headerTintColor: ink.text,
          headerTitleStyle: { color: ink.text },
          contentStyle: { backgroundColor: ink.bg },
        }}
      />
      <StatusBar style="light" />
      {term.status === 'ended' && <Banner text="This terminal has exited." />}
      {(term.status === 'connecting' || term.status === 'closed') && <Banner text={term.status === 'connecting' ? 'Connecting…' : 'Reconnecting…'} />}
      {!!term.error && <Banner tone="danger" text={term.error} onPress={() => term.setError('')} />}
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          term.resize(Math.floor((width - 8) / (FS * 0.6)), Math.floor(height / (FS * 1.3)));
        }}
      >
        <ScrollView horizontal contentContainerStyle={{ padding: space.xs }}>
          <AnsiText text={term.screen} fontSize={FS} />
        </ScrollView>
      </ScrollView>
      <View style={{ borderTopWidth: 1, borderTopColor: ink.line }}>
        <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space.xs + 2, padding: space.sm }}>
          <Key label="ctrl" on={ctrl} onPress={() => setCtrl(!ctrl)} />
          {KEYS.map(([label, seq]) => (
            <Key key={label} label={label} onPress={() => term.input(seq)} />
          ))}
        </ScrollView>
      </View>
      <View style={{ paddingHorizontal: space.sm, paddingBottom: Math.max(insets.bottom, space.sm) }}>
        <TextInput
          mono
          style={[scale.subhead, { color: ink.text, backgroundColor: ink.card, borderWidth: 1, borderColor: ink.line, borderRadius: radius.card, borderCurve: 'continuous', paddingHorizontal: space.md, paddingVertical: space.md - 1 }]}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          placeholder={ctrl ? 'ctrl + letter…' : 'Type a command (⏎ sends)'}
          placeholderTextColor={ink.faint}
          selectionColor={ink.accent}
          keyboardAppearance="dark"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          submitBehavior="submit"
          accessibilityLabel="Command"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function Key({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={on === undefined ? undefined : { selected: on }}
      style={{ minWidth: 34, height: 30, paddingHorizontal: space.sm + 2, alignItems: 'center', justifyContent: 'center', borderRadius: radius.control, borderCurve: 'continuous', backgroundColor: on ? ink.accent : ink.muted }}
    >
      <Text mono variant="footnote" style={{ color: on ? ink.onAccent : ink.text }}>{label}</Text>
    </Press>
  );
}
