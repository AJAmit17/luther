import { useState } from 'react';
import { View } from 'react-native';
import { Chip, Icon, StatusDot, Surface, Text, space, useTheme } from '@/design';
import { del } from '@/lib/hosts';
import type { Goal } from '@/lib/protocol';

const ended: Record<string, string> = { done: 'Reached', blocked: 'Blocked', limit: 'Out of rounds', stopped: 'Stopped', failed: 'Stopped: the turn failed', paused: 'Paused' };

// The thread's goal, above the composer: where it stands, the judge's last
// word, and Stop. A finished goal stays until you close it.
export function GoalPanel({ thread, goal }: { thread: string; goal: Goal }) {
  const { color } = useTheme();
  const [hidden, setHidden] = useState('');
  const active = goal.status === 'working' || goal.status === 'judging';
  if (!active && hidden === goal.objective + goal.status) return null;
  const head = active ? `Round ${goal.round} of ${goal.rounds}${goal.status === 'judging' ? ' · checking…' : ''}` : ended[goal.status];
  const good = goal.status === 'done';
  return (
    <Surface style={{ padding: space.md, gap: space.xs + 2, borderColor: active ? color.line : good ? color.green : color.warn }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {active ? <StatusDot color={color.accent} live size={7} /> : <Icon name={good ? 'checkmark.circle.fill' : 'exclamationmark.triangle.fill'} size={15} color={good ? color.green : color.warn} />}
        <Text variant="caption" weight="medium" color={active ? 'accent' : good ? 'green' : 'warn'} style={{ flex: 1 }}>GOAL · {head.toUpperCase()}</Text>
        <Chip
          label={active ? 'Stop Goal' : 'Close'}
          tone={active ? 'danger' : 'accent'}
          onPress={() => (active ? del(`/threads/${encodeURIComponent(thread)}/goal`).catch(() => {}) : setHidden(goal.objective + goal.status))}
        />
      </View>
      <Text variant="subhead" weight="medium" numberOfLines={2}>{goal.objective}</Text>
      {!!goal.note && <Text variant="footnote" numberOfLines={3}>{goal.note}</Text>}
    </Surface>
  );
}
