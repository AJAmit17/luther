import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { del } from '@/lib/hosts';
import type { Goal } from '@/lib/protocol';
import { Icon, PulsingDot, c, card, tint, type, useHex } from '@/components/ui';

const ended: Record<string, string> = { done: 'Reached', blocked: 'Blocked', limit: 'Out of rounds', stopped: 'Stopped', failed: 'Stopped: the turn failed', paused: 'Paused' };

// The thread's goal, above the composer: where it stands, the judge's last
// word, and Stop. A finished goal stays until you close it.
export function GoalPanel({ thread, goal }: { thread: string; goal: Goal }) {
  useHex();
  const [hidden, setHidden] = useState('');
  const active = goal.status === 'working' || goal.status === 'judging';
  if (!active && hidden === goal.objective + goal.status) return null;
  const head = active ? `Round ${goal.round} of ${goal.rounds}${goal.status === 'judging' ? ' · checking…' : ''}` : ended[goal.status];
  const good = goal.status === 'done';
  return (
    <View style={[card, { padding: 12, gap: 6, borderColor: active ? c.line : good ? c.green : c.warn }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {active ? <PulsingDot size={7} /> : <Icon name={good ? 'checkmark.circle.fill' : 'exclamationmark.triangle.fill'} size={15} color={good ? c.green : c.warn} />}
        <Text style={[type.caption, { fontWeight: '600', color: active ? c.accent : good ? c.green : c.warn }]}>GOAL · {head.toUpperCase()}</Text>
        <View style={{ flex: 1 }} />
        <Pressable
          hitSlop={8}
          onPress={() => (active ? del(`/threads/${encodeURIComponent(thread)}/goal`).catch(() => {}) : setHidden(goal.objective + goal.status))}
          style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: tint(active ? 'red' : 'accent', pressed ? 0.2 : 0.1) })}
        >
          <Text style={[type.caption, { fontWeight: '600', color: active ? c.red : c.accent }]}>{active ? 'Stop goal' : 'Close'}</Text>
        </Pressable>
      </View>
      <Text style={[type.subhead, { fontWeight: '500' }]} numberOfLines={2}>{goal.objective}</Text>
      {!!goal.note && <Text style={type.footnote} numberOfLines={3}>{goal.note}</Text>}
    </View>
  );
}
