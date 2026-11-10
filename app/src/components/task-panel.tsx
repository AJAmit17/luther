import { useState } from 'react';
import { LayoutAnimation, View } from 'react-native';
import { Icon, Press, Surface, Text, space, useTheme } from '@/design';
import type { Task } from '@/lib/protocol';

// The agent's own plan (Claude's to-dos, Codex's plan): the current step and a
// progress bar; tap for every step.
export function TaskPanel({ tasks }: { tasks: Task[] }) {
  const { color } = useTheme();
  const [open, setOpen] = useState(false);
  const done = tasks.filter((t) => t.status === 'completed').length;
  const now = tasks.find((t) => t.status === 'in_progress') ?? tasks.find((t) => t.status === 'pending');
  return (
    <Press
      onPress={() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setOpen((o) => !o);
      }}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      scale={1}
    >
      <Surface style={{ padding: space.md, gap: space.sm + 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Icon name="checklist" size={15} color={color.accent} />
          <Text variant="subhead" weight="medium" style={{ flex: 1 }} numberOfLines={1}>{now?.text ?? 'All steps done'}</Text>
          <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>{done}/{tasks.length}</Text>
          <Icon name={open ? 'chevron.down' : 'chevron.up'} size={11} color={color.faint} />
        </View>
        <View style={{ height: 3, borderRadius: 2, backgroundColor: color.muted, overflow: 'hidden' }}>
          <View style={{ width: `${(done / Math.max(1, tasks.length)) * 100}%`, height: 3, backgroundColor: color.accent }} />
        </View>
        {open &&
          tasks.map((t, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: space.sm }}>
              <Icon name={t.status === 'completed' ? 'checkmark.circle.fill' : t.status === 'in_progress' ? 'circle.dotted' : 'circle'} size={15} color={t.status === 'completed' ? color.green : t.status === 'in_progress' ? color.accent : color.faint} />
              <Text variant="subhead" color={t.status === 'completed' ? 'dim' : undefined} style={[{ flex: 1 }, t.status === 'completed' && { textDecorationLine: 'line-through' }]}>{t.text}</Text>
            </View>
          ))}
      </Surface>
    </Press>
  );
}
