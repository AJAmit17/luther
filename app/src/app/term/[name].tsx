import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnsiText } from '@/lib/ansi';
import { useTerm } from '@/lib/socket';
import { Banner, mono } from '@/lib/ui';

const FS = 11;
const KEYS: [string, string][] = [
  ['esc', '\x1b'], ['tab', '\t'], ['⇧tab', '\x1b[Z'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C'], ['⏎', '\r'], ['^C', '\x03'], ['^D', '\x04'],
];

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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#000' }} behavior="padding" keyboardVerticalOffset={insets.top + 44}>
      <Stack.Screen options={{ title: `Terminal · ${cwd?.split('/').pop() || name}` }} />
      {term.status === 'ended' && <Banner text="This terminal has exited." />}
      {(term.status === 'connecting' || term.status === 'closed') && <Banner text={term.status === 'connecting' ? 'Connecting…' : 'Reconnecting…'} />}
      {!!term.error && <Banner error text={term.error} onPress={() => term.setError('')} />}
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          term.resize(Math.floor((width - 8) / (FS * 0.6)), Math.floor(height / (FS * 1.3)));
        }}
      >
        <ScrollView horizontal contentContainerStyle={{ padding: 4 }}>
          <AnsiText text={term.screen} fontSize={FS} />
        </ScrollView>
      </ScrollView>
      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6, padding: 6 }}>
        <Pressable onPress={() => setCtrl(!ctrl)} style={[key, { backgroundColor: ctrl ? '#d97757' : '#222' }]}>
          <Text style={{ color: '#eee', fontFamily: mono }}>ctrl</Text>
        </Pressable>
        {KEYS.map(([label, seq]) => (
          <Pressable key={label} onPress={() => term.input(seq)} style={({ pressed }) => [key, { backgroundColor: pressed ? '#444' : '#222' }]}>
            <Text style={{ color: '#eee', fontFamily: mono }}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ paddingHorizontal: 8, paddingTop: 4, paddingBottom: Math.max(insets.bottom, 8) }}>
        <TextInput
          style={{ color: '#eee', backgroundColor: '#1a1a1a', borderRadius: 10, padding: 11, fontFamily: mono, fontSize: 14 }}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          placeholder={ctrl ? 'ctrl + letter…' : 'command (⏎ sends)'}
          placeholderTextColor="#777"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          submitBehavior="submit"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const key = { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderCurve: 'continuous' } as const;
