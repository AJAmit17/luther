import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, TextInput } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Stack, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HttpError, api } from '@/lib/hosts';
import type { FileContent } from '@/lib/protocol';
import { Banner, Note, c, mono, useHex } from '@/components/ui';

// Edit a text file in the project (instructions like CLAUDE.md, mostly). A file
// that doesn't exist yet is created on save. Saving is refused if the file
// changed on the Mac meanwhile, so an agent's edit is never overwritten.
export default function Edit() {
  useHex();
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
    Alert.alert('Discard your changes?', `${path} isn't saved.`, [
      { text: 'Keep editing', style: 'cancel' },
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
            ? Alert.alert('Changed on the Mac', `${e.message}\n\nYour text stays here; copy what you need, then reload.`, [
                { text: 'Keep mine', style: 'cancel' },
                { text: 'Reload theirs', style: 'destructive', onPress: () => void load() },
              ])
            : Alert.alert('Could not save', e.message),
      )
      .finally(() => setBusy(false));
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg as any }} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <Stack.Screen options={{ title: path.split('/').pop() }} />
      <Stack.Toolbar placement="right">
        {busy ? (
          <Stack.Toolbar.View>
            <ActivityIndicator />
          </Stack.Toolbar.View>
        ) : (
          <Stack.Toolbar.Button disabled={!dirty && exists} onPress={save}>{exists ? 'Save' : 'Create'}</Stack.Toolbar.Button>
        )}
      </Stack.Toolbar>
      {!exists && <Banner text={`${path} doesn't exist yet. Write it and tap Create.`} />}
      {!!error && <Note error>{error}</Note>}
      {saved !== null && !error && (
        <TextInput
          style={{ flex: 1, color: c.text, fontFamily: mono, fontSize: 13, lineHeight: 19, padding: 14, paddingBottom: Math.max(insets.bottom, 14), textAlignVertical: 'top' }}
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
