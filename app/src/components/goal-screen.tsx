import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Field, SectionHeader, Segmented, Surface, Text, Tile, alert, space, useTheme, SheetFooter, SheetHeader } from '@/design';
import { post } from '@/lib/hosts';

const ROUNDS = [5, 10, 20, 30].map((n) => ({ id: n, label: `${n} Rounds` }));

// Set a goal on a thread (a sheet): the objective and how many rounds it may take.
export default function GoalSheet() {
  const { color } = useTheme();
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
        alert('Couldn’t set the goal', e.message);
      },
    );
  };
  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ padding: space.lg + space.xs, paddingTop: space.xl + space.xs, gap: space.lg + space.xs }}>
        <SheetHeader title="Work Toward a Goal" />
        <Field lines={4} value={objective} onChangeText={setObjective} autoFocus placeholder="e.g. All tests pass and the README documents the new flag" />
        <View style={{ gap: space.sm }}>
          <SectionHeader title="At Most" />
          <Segmented options={ROUNDS} value={rounds} onChange={setRounds} />
          <Text variant="footnote" style={{ paddingHorizontal: space.lg }}>After each turn a separate model reads only the goal and the reply, and decides: done, blocked, or keep going with what’s still missing.</Text>
        </View>
        <Surface style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md + 2 }}>
          <Tile icon="target" color={color.accent} />
          <View style={{ flex: 1, gap: space.xxs }}>
            <Text variant="subhead" weight="medium">Stops by itself</Text>
            <Text variant="footnote">When the goal is met, when it’s blocked, or after the last round. Stop it anytime from the thread.</Text>
          </View>
        </Surface>
      </ScrollView>
      <SheetFooter>
        <View style={{ flex: 1 }}>
          <Button variant="primary" label={busy ? 'Starting…' : 'Start Goal'} busy={busy} disabled={!objective.trim()} onPress={start} />
        </View>
      </SheetFooter>
    </View>
  );
}
