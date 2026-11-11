import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Stack, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HttpError, api } from '@/lib/hosts';
import type { FileContent } from '@/lib/protocol';
import { Banner, HeaderActions, Note, TextInput, alert, space, type as scale, useTheme } from '@/design';

// Edit a project text file (created on save if missing). Saving is refused if the file
// changed on the Mac meanwhile, so an agent's edit is never overwritten.
export default function Edit() {
  const { color } = useTheme();
  const { cwd, path, template } = useLocalSearchParams<{ cwd: string; path: string; template?: string }>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [text, setText] = useState('');
  const [saved, setSaved] = useState<string | null>(null); // null: not loaded
  const [base, setBase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [exists, setExists] = useState(true);
  const dirty = saved !== null && text !== saved;

  const load = () =>
    api<FileContent>(`/files?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`).then(
      (f) => {
        if (f.binary || f.truncated || !f.hash) return setError('This file is too big or not text; it can only be viewed.');
        setText(f.text);
        setSaved(f.text);
        setBase(f.hash);
        setExists(true);
      },
      (e) => {
        if (e instanceof HttpError && e.status === 404) {
          setText(template ?? '');
          setSaved('');
          setBase('');
          setExists(false);
        } else setError(e.message);
      },
    );
  useEffect(() => {
    void load();
  }, [cwd, path]); // eslint-disable-line react-hooks/exhaustive-deps

  // Discard: stop preventing first (a render), then let the back navigation go.
  const leave = useRef<(() => void) | null>(null);
  usePreventRemove(dirty, ({ repeat }) =>
    alert('Discard your changes?', `${path} isn't saved.`, [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { leave.current = repeat; setSaved(text); } },
    ]),
  );
  useEffect(() => {
    if (!dirty && leave.current) {
      const go = leave.current;
      leave.current = null;
      go();
    }
  }, [dirty]);

  const save = () => {
    setBusy(true);
    api<FileContent>('/files', { method: 'PUT', body: JSON.stringify({ cwd, path, text, base }) })
      .then(
        (f) => {
          setSaved(text);
          setBase(f.hash ?? '');
          setExists(true);
        },
        (e) =>
          e instanceof HttpError && e.status === 409
            ? alert('Changed on the Mac', `${e.message}\n\nYour text stays here; copy what you need, then reload.`, [
                { text: 'Keep Mine', style: 'cancel' },
                { text: 'Reload Theirs', style: 'destructive', onPress: () => void load() },
              ])
            : alert('Could not save', e.message),
      )
      .finally(() => setBusy(false));
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.bg }} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <Stack.Screen options={{ title: path.split('/').pop() }} />
      <HeaderActions actions={[{ text: exists ? 'Save' : 'Create', disabled: !dirty && exists, busy, onPress: save }]} />
      {!exists && <Banner text={`${path} doesn't exist yet. Write it and tap Create.`} />}
      {!!error && (
        <View style={{ padding: space.lg }}>
          <Note tone="danger">{error}</Note>
        </View>
      )}
      {saved !== null && !error && (
        <TextInput
          mono
          style={[scale.footnote, { flex: 1, padding: space.md + 2, paddingBottom: Math.max(insets.bottom, space.md + 2), textAlignVertical: 'top' }]}
          value={text}
          onChangeText={setText}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          scrollEnabled
        />
      )}
    </KeyboardAvoidingView>
  );
}
