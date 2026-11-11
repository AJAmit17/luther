import { View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Press, SectionHeader, Text, palettes, radius, setAppearance, space, tint, useAppearance, useTheme, type Appearance } from '@/design';

/** A tiny phone in a scheme: the accent dot, a few lines, a message bubble. */
function Phone({ scheme }: { scheme: 'light' | 'dark' }) {
  const p = palettes[scheme];
  const bar = (width: number, alpha: number) => <View style={{ height: 4, width, borderRadius: 2, backgroundColor: tint(p.text, alpha) }} />;
  return (
    <View style={{ flex: 1, backgroundColor: p.bg, padding: 7, gap: 5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.accent }} />
        {bar(20, 0.5)}
      </View>
      {bar(26, 0.15)}
      {bar(18, 0.15)}
      <View style={{ alignSelf: 'flex-end', height: 9, width: 22, borderRadius: 5, backgroundColor: p.muted, marginTop: space.xs }} />
      <View style={{ flex: 1 }} />
      <View style={{ height: 10, borderRadius: 5, backgroundColor: p.card, borderWidth: 1, borderColor: p.line }} />
    </View>
  );
}

const OPTIONS: { id: Appearance; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

// Settings → Appearance: follow the iPhone, or always light, or always dark.
export function AppearancePicker() {
  const { color } = useTheme();
  const choice = useAppearance();
  return (
    <View style={{ gap: space.xs + 2 }}>
      <SectionHeader title="Appearance" />
      <View style={{ flexDirection: 'row', gap: space.sm + 2 }}>
        {OPTIONS.map(({ id, label }) => {
          const on = choice === id;
          return (
            <Press
              key={id}
              onPress={() => {
                void Haptics.selectionAsync();
                setAppearance(id);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={label}
              style={{ flex: 1, alignItems: 'center', gap: space.sm, paddingVertical: space.md + 2, borderRadius: radius.card, borderCurve: 'continuous', backgroundColor: color.card, borderWidth: 2, borderColor: on ? color.accent : color.line }}
            >
              <View style={{ width: 58, height: 96, borderRadius: radius.card, borderWidth: 3, borderColor: palettes.dark.bg, overflow: 'hidden', flexDirection: 'row' }}>
                {id === 'system' ? (
                  <>
                    <View style={{ flex: 1, overflow: 'hidden' }}><View style={{ width: 52, flex: 1 }}><Phone scheme="light" /></View></View>
                    <View style={{ flex: 1, overflow: 'hidden', alignItems: 'flex-end' }}><View style={{ width: 52, flex: 1 }}><Phone scheme="dark" /></View></View>
                  </>
                ) : (
                  <Phone scheme={id} />
                )}
              </View>
              <Text variant="subhead" weight={on ? 'medium' : 'regular'} color={on ? 'text' : 'dim'}>{label}</Text>
            </Press>
          );
        })}
      </View>
    </View>
  );
}
