import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { post } from '@/lib/hosts';
import { Button, Group, GroupRow, Icon, c, type, useHex } from '@/components/ui';

const ROUNDS = [5, 10, 20, 30];

// Set a goal on a thread (a sheet): the objective and how many rounds it may take.
export default function GoalSheet() {
  useHex();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [objective, setObjective] = useState('');
  const [rounds, setRounds] = useState(10);
  const [busy, setBusy] = useState(false);
  const start = () => {
    setBusy(true);
    post(`/threads/${encodeURIComponent(id)}/goal`, { objective, rounds }).then(
      () => router.back(),
      (e) => {
        setBusy(false);
        Alert.alert('Couldn’t set the goal', e.message);
      },
    );
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.surface }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingTop: 28, gap: 20, paddingBottom: 40 + insets.bottom }}>
      <View style={{ gap: 4 }}>
        <Text style={type.title2}>Work toward a goal</Text>
        <Text style={type.footnote}>The agent keeps going, turn after turn. After each turn a separate model reads only the goal and the reply, and decides: done, blocked, or keep going with what’s still missing.</Text>
      </View>
      <TextInput
        value={objective}
        onChangeText={setObjective}
        autoFocus
        multiline
        placeholder="e.g. All tests pass and the README documents the new flag"
        placeholderTextColor={c.dim}
        style={{ minHeight: 110, color: c.text, backgroundColor: c.card, borderRadius: 14, borderCurve: 'continuous', padding: 14, fontSize: 16, textAlignVertical: 'top' }}
      />
      <Group title="At most" footer="Each round is one turn. Stop anytime from the thread.">
        {ROUNDS.map((n, i) => (
          <GroupRow key={n} first={i === 0} icon="arrow.triangle.2.circlepath" label={`${n} rounds`} right={rounds === n ? <Icon name="checkmark" size={15} color={c.accent} /> : <View style={{ width: 15 }} />} onPress={() => setRounds(n)} />
        ))}
      </Group>
      <Button kind="accent" icon="play.fill" label={busy ? 'Starting…' : 'Start'} busy={busy} disabled={!objective.trim()} onPress={start} />
    </ScrollView>
  );
}
