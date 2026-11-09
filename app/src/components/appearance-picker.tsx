import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { setAppearance, useAppearance, type Choice } from '@/lib/theme';
import { SectionTitle, c, palettes, type, useHex } from '@/components/ui';

/** A tiny phone in a scheme: the accent dot, a few lines, a message bubble. */
function Phone({ scheme }: { scheme: 'light' | 'dark' }) {
  const p = palettes[scheme];
  const bar = (width: number, a: string) => <View style={{ height: 4, width, borderRadius: 2, backgroundColor: p.text + a }} />;
  return (
    <View style={{ flex: 1, backgroundColor: p.bg, padding: 7, gap: 5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.accent }} />
        {bar(20, '80')}
      </View>
      {bar(26, '26')}
      {bar(18, '26')}
      <View style={{ alignSelf: 'flex-end', height: 9, width: 22, borderRadius: 5, backgroundColor: p.muted, marginTop: 4 }} />
      <View style={{ flex: 1 }} />
      <View style={{ height: 10, borderRadius: 5, backgroundColor: p.card, borderWidth: 1, borderColor: p.line }} />
    </View>
  );
}

const OPTIONS: { id: Choice; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

// Settings → Appearance: follow the iPhone, or always light, or always dark.
export function AppearancePicker() {
  useHex();
  const choice = useAppearance();
  return (
    <View style={{ gap: 6 }}>
      <SectionTitle>Appearance</SectionTitle>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {OPTIONS.map(({ id, label }) => {
          const on = choice === id;
          return (
            <Pressable
              key={id}
              onPress={() => {
                void Haptics.selectionAsync();
                setAppearance(id);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={label}
              style={{ flex: 1, alignItems: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, borderCurve: 'continuous', backgroundColor: c.card, borderWidth: 2, borderColor: on ? c.accent : c.line }}
            >
              <View style={{ width: 58, height: 96, borderRadius: 12, borderWidth: 3, borderColor: '#0B0B0C', overflow: 'hidden', flexDirection: 'row' }}>
                {id === 'system' ? (
                  <>
                    <View style={{ flex: 1, overflow: 'hidden' }}><View style={{ width: 52, flex: 1 }}><Phone scheme="light" /></View></View>
                    <View style={{ flex: 1, overflow: 'hidden', alignItems: 'flex-end' }}><View style={{ width: 52, flex: 1 }}><Phone scheme="dark" /></View></View>
                  </>
                ) : (
                  <Phone scheme={id} />
                )}
              </View>
              <Text style={[type.subhead, { fontWeight: on ? '600' : '400', color: on ? c.text : c.dim }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
