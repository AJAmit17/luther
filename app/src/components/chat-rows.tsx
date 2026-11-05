import { Text, View } from 'react-native';
import { Markdown } from '@/components/markdown';
import { Icon, c, mono } from '@/components/ui';
import type { Msg } from '@/lib/protocol';

// One chat row: user bubble, assistant markdown, tool step or system line.
export function Bubble({ m }: { m: Msg }) {
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
  t === 'Bash' || t === 'Shell' ? 'terminal' : t === 'Edit' || t === 'Write' || t === 'MultiEdit' ? 'pencil' : t === 'Read' ? 'doc.text' : t === 'Grep' || t === 'Glob' ? 'magnifyingglass' : t?.startsWith('Web') ? 'globe' : 'wrench.and.screwdriver';
