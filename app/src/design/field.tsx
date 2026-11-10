import { useState, type ComponentPropsWithRef } from 'react';
import { View } from 'react-native';
import { IconButton } from './button';
import { Icon } from './primitives';
import { Text, TextInput } from './text';
import { useTheme } from './theme';
import { radius, space } from './tokens';

type FieldProps = ComponentPropsWithRef<typeof TextInput> & { label?: string; lines?: number };

/** A text field in a card. `lines` > 1 makes it multiline, growing to that many lines. */
export function Field({ label, lines = 1, style, ...p }: FieldProps) {
  const { color } = useTheme();
  const multiline = lines > 1;
  return (
    <View style={{ gap: space.xs + 2 }}>
      {!!label && <Text variant="footnote" weight="medium" style={{ paddingHorizontal: space.xs, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</Text>}
      <TextInput
        accessibilityLabel={label ?? p.placeholder}
        multiline={multiline}
        {...p}
        style={[
          { backgroundColor: color.card, borderWidth: 1, borderColor: color.line, borderRadius: radius.card, borderCurve: 'continuous', paddingHorizontal: space.md + 2, paddingVertical: space.md },
          multiline && { minHeight: 22 * Math.min(lines, 4) + space.xl, maxHeight: 22 * lines + space.xl, textAlignVertical: 'top' },
          style,
        ]}
      />
    </View>
  );
}

/** A search box: a magnifier, the query, and a clear button once there is one. */
export function SearchField({ placeholder, onChange, live }: { placeholder: string; onChange: (query: string) => void; live?: boolean }) {
  const { color } = useTheme();
  const [query, setQuery] = useState('');
  const change = (q: string) => {
    setQuery(q);
    if (live || !q) onChange(q);
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 40, paddingHorizontal: space.md, borderRadius: radius.card, borderCurve: 'continuous', backgroundColor: color.muted }}>
      <Icon name="magnifyingglass" size={18} color={color.faint} />
      <TextInput
        value={query}
        onChangeText={change}
        onSubmitEditing={() => onChange(query.trim())}
        placeholder={placeholder}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={placeholder}
        style={{ flex: 1, paddingVertical: 0 }}
      />
      {!!query && <IconButton icon="xmark.circle.fill" label="Clear search" size={28} onPress={() => change('')} />}
    </View>
  );
}
