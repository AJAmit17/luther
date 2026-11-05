import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Task } from '@/lib/protocol';
import { Icon, c } from '@/components/ui';

// The agent's own to-do list (Claude's TodoWrite, Codex's plan): one line with
// the current task and the count; tap for the whole list.
export function TaskPanel({ tasks }: { tasks: Task[] }) {
  const [open, setOpen] = useState(false);
  const done = tasks.filter((t) => t.status === 'completed').length;
  const now = tasks.find((t) => t.status === 'in_progress') ?? tasks.find((t) => t.status === 'pending');
  return (
    <Pressable onPress={() => setOpen((o) => !o)} style={{ paddingHorizontal: 14, paddingVertical: 8, gap: 6, borderTopWidth: 0.5, borderColor: c.line as any }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="checklist" size={15} color={c.accent} />
        <Text style={{ flex: 1, color: c.text, fontSize: 13 }} numberOfLines={1}>{now?.text ?? 'All tasks done'}</Text>
        <Text style={{ color: c.dim, fontSize: 12, fontVariant: ['tabular-nums'] }}>{done}/{tasks.length}</Text>
        <Icon name={open ? 'chevron.down' : 'chevron.up'} size={11} color={c.faint} />
      </View>
      {open &&
        tasks.map((t, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, paddingLeft: 2 }}>
            <Icon name={t.status === 'completed' ? 'checkmark.circle.fill' : t.status === 'in_progress' ? 'circle.dotted' : 'circle'} size={14} color={t.status === 'completed' ? c.green : t.status === 'in_progress' ? c.accent : c.faint} />
            <Text style={{ flex: 1, color: t.status === 'completed' ? c.dim : c.text, fontSize: 13, textDecorationLine: t.status === 'completed' ? 'line-through' : 'none' }}>{t.text}</Text>
          </View>
        ))}
    </Pressable>
  );
}
