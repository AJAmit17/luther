import { useState, useSyncExternalStore } from 'react';
import { View, type AlertButton } from 'react-native';
import { Card, CardRow, Overlay } from './overlay.android';
import { Text, TextInput } from './text';
import { useTheme } from './theme';
import { radius, space } from './tokens';

type Shown = { title: string; message?: string; buttons: AlertButton[]; input?: { value: string; secure: boolean; done: (text: string) => void } };
let queue: Shown[] = [];
let last: Shown | undefined; // stays drawn while the Modal fades it out
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const first = () => queue[0];
const show = (d: Shown) => {
  queue = [...queue, d];
  notify();
};
const dismiss = () => {
  last = queue[0];
  queue = queue.slice(1);
  notify();
};

export function alert(title: string, message?: string, buttons?: AlertButton[]) {
  show({ title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }] });
}

export function prompt(title: string, message: string | undefined, done: (text: string) => void, kind: 'plain-text' | 'secure-text' = 'plain-text', value = '') {
  show({ title, message, buttons: [{ text: 'Cancel', style: 'cancel' }, { text: 'OK' }], input: { value, secure: kind === 'secure-text', done } });
}

export function DialogHost() {
  const { color } = useTheme();
  const d = useSyncExternalStore(subscribe, first);
  const [text, setText] = useState<string | null>(null);
  const k = d ?? last;
  if (!k) return null;
  const value = text ?? k.input?.value ?? '';
  const press = (b: AlertButton) => {
    dismiss();
    setText(null);
    if (k.input && b.style !== 'cancel') k.input.done(value);
    b.onPress?.();
  };
  // Back dismisses like Cancel, or like the only button (an OK-only alert).
  const back = k.buttons.find((b) => b.style === 'cancel') ?? (k.buttons.length === 1 ? k.buttons[0] : undefined);
  const stacked = k.buttons.length > 2;
  return (
    <Overlay open={!!d} onClose={() => back && press(back)}>
      <View pointerEvents="box-none" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <Card key={k.title} role="alert" style={{ width: '100%', maxWidth: 300 }}>
          <View style={{ padding: 18, paddingBottom: 16, gap: 6, alignItems: 'center' }}>
            <Text variant="headline" style={{ textAlign: 'center' }}>{k.title}</Text>
            {!!k.message && <Text variant="footnote" color="text" style={{ textAlign: 'center' }}>{k.message}</Text>}
            {k.input && (
              <TextInput
                autoFocus
                value={value}
                onChangeText={setText}
                secureTextEntry={k.input.secure}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={k.title}
                onSubmitEditing={() => press(k.buttons[k.buttons.length - 1])}
                style={{ alignSelf: 'stretch', marginTop: space.sm, paddingHorizontal: 10, paddingVertical: space.sm, borderRadius: radius.control, borderWidth: 1, borderColor: color.line, backgroundColor: color.bg }}
              />
            )}
          </View>
          <View style={{ flexDirection: stacked ? 'column' : 'row' }}>
            {k.buttons.map((b, i) => (
              <CardRow key={i} accessibilityRole="button" onPress={() => press(b)} style={{ flex: stacked ? undefined : 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderLeftWidth: !stacked && i ? 1 : 0, borderLeftColor: color.line }}>
                <Text color={b.style === 'destructive' ? 'red' : 'text'} weight={b.style === 'cancel' ? 'regular' : 'medium'}>{b.text}</Text>
              </CardRow>
            ))}
          </View>
        </Card>
      </View>
    </Overlay>
  );
}
