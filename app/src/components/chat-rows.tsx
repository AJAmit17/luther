import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Markdown } from '@/components/markdown';
import { Icon, c, mono } from '@/components/ui';
import type { Msg } from '@/lib/protocol';

// One chat row: user bubble, assistant markdown, tool step or system line. A
// subagent call carries its own steps, folded until tapped.
export function Bubble({ m, steps }: { m: Msg; steps?: Msg[] }) {
  if (steps?.length) return <Subagent m={m} steps={steps} />;
  if (m.role === 'user')
    return (
      <View style={{ alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: c.fill, borderRadius: 18, borderCurve: 'continuous', paddingHorizontal: 14, paddingVertical: 9, marginVertical: 4 }}>
        <Text selectable style={{ color: c.text, fontSize: 16, lineHeight: 22 }}>{m.text}</Text>
      </View>
    );
  if (m.role === 'tool')
    return (
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginVertical: 1 }}>
        <Icon name={toolIcon(m.tool)} size={12} color={c.accent} />
        <Text style={{ color: c.dim, fontSize: 13, flex: 1 }} numberOfLines={2}>
          <Text style={{ color: c.text, fontFamily: mono, fontSize: 12 }}>{m.tool}</Text>
          {m.text ? '  ' + m.text : ''}
        </Text>
      </View>
    );
  if (m.role === 'system') return <Text selectable style={{ color: c.dim, fontSize: 12, fontFamily: mono, marginVertical: 6, textAlign: 'center' }}>{m.text}</Text>;
  return <View style={{ marginVertical: 6 }}><Markdown text={m.text} /></View>;
}

const toolIcon = (t?: string) =>
  t === 'Bash' || t === 'Shell' ? 'terminal' : t === 'Edit' || t === 'Write' || t === 'MultiEdit' ? 'pencil' : t === 'Read' ? 'doc.text' : t === 'Grep' || t === 'Glob' ? 'magnifyingglass' : t?.startsWith('Web') ? 'globe' : t === 'Task' || t === 'Agent' ? 'person.2' : 'wrench.and.screwdriver';

function Subagent({ m, steps }: { m: Msg; steps: Msg[] }) {
  const [open, setOpen] = useState(false);
  const tools = steps.filter((x) => x.role === 'tool');
  const last = tools[tools.length - 1];
  return (
    <Pressable onPress={() => setOpen((o) => !o)} style={{ marginVertical: 3, padding: 10, gap: 4, borderRadius: 12, borderCurve: 'continuous', backgroundColor: c.card }}>
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <Icon name="person.2" size={13} color={c.accent} />
        <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', flex: 1 }} numberOfLines={1}>{m.text || 'Subagent'}</Text>
        <Text style={{ color: c.dim, fontSize: 12 }}>{tools.length} step{tools.length === 1 ? '' : 's'}</Text>
        <Icon name={open ? 'chevron.up' : 'chevron.down'} size={11} color={c.faint} />
      </View>
      {open ? (
        <View style={{ gap: 2, paddingLeft: 4 }}>
          {steps.map((x) => (x.role === 'assistant' ? <Text key={x.id} style={{ color: c.dim, fontSize: 13 }}>{x.text}</Text> : <Bubble key={x.id} m={x} />))}
        </View>
      ) : last ? (
        <Text style={{ color: c.dim, fontSize: 12, fontFamily: mono }} numberOfLines={1}>{last.tool} {last.text}</Text>
      ) : null}
    </Pressable>
  );
}
