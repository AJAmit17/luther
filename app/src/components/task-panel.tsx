import { useState } from 'react';
import { LayoutAnimation, Pressable, Text, View } from 'react-native';
import type { Task } from '@/lib/protocol';
import { Icon, c, card, type } from '@/components/ui';

// The agent's own plan (Claude's to-dos, Codex's plan): the current step and a
// progress bar; tap for every step.
export function TaskPanel({ tasks }: { tasks: Task[] }) {
  const [open, setOpen] = useState(false);
  const done = tasks.filter((t) => t.status === 'completed').length;
  const now = tasks.find((t) => t.status === 'in_progress') ?? tasks.find((t) => t.status === 'pending');
  return (
    <Pressable
      onPress={() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setOpen((o) => !o);
      }}
      style={[card, { padding: 12, gap: 9 }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="checklist" size={15} color={c.accent} />
        <Text style={[type.subhead, { flex: 1, fontWeight: '500' }]} numberOfLines={1}>{now?.text ?? 'All steps done'}</Text>
        <Text style={[type.caption, { fontVariant: ['tabular-nums'] }]}>{done}/{tasks.length}</Text>
        <Icon name={open ? 'chevron.down' : 'chevron.up'} size={11} color={c.faint} />
      </View>
      <View style={{ height: 3, borderRadius: 2, backgroundColor: c.muted, overflow: 'hidden' }}>
        <View style={{ width: `${(done / Math.max(1, tasks.length)) * 100}%`, height: 3, backgroundColor: c.accent }} />
      </View>
      {open &&
        tasks.map((t, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
            <Icon name={t.status === 'completed' ? 'checkmark.circle.fill' : t.status === 'in_progress' ? 'circle.dotted' : 'circle'} size={15} color={t.status === 'completed' ? c.green : t.status === 'in_progress' ? c.accent : c.faint} />
            <Text style={[type.subhead, { flex: 1 }, t.status === 'completed' && { color: c.dim, textDecorationLine: 'line-through' }]}>{t.text}</Text>
          </View>
        ))}
    </Pressable>
  );
}
