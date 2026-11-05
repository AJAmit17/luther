import { Text, View } from 'react-native';
import { c, mono } from '@/components/ui';

// ponytail: tiny markdown subset (fences, headings, lists, quotes, `code`, **bold**) —
// enough for agent replies. Swap for a full renderer if tables/links matter.

function Inline({ text, style }: { text: string; style?: object }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <Text style={[{ color: c.text, fontSize: 15, lineHeight: 21 }, style]} selectable>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') && p.length > 1 ? (
          <Text key={i} style={{ fontFamily: mono, fontSize: 13, backgroundColor: c.card, color: c.accent }}>{p.slice(1, -1)}</Text>
        ) : p.startsWith('**') && p.endsWith('**') && p.length > 3 ? (
          <Text key={i} style={{ fontWeight: '700' }}>{p.slice(2, -2)}</Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

export function Markdown({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('```')) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      out.push(
        <View key={i} style={{ backgroundColor: c.card, borderRadius: 6, padding: 8, marginVertical: 4 }}>
          <Text selectable style={{ fontFamily: mono, fontSize: 12, color: c.text }}>{code.join('\n')}</Text>
        </View>,
      );
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)/);
    const li = l.match(/^(\s*)([-*]|\d+\.)\s+(.*)/);
    if (h) out.push(<Inline key={i} text={h[2]} style={{ fontWeight: '700', fontSize: h[1].length <= 2 ? 17 : 15, marginTop: 6 }} />);
    else if (li)
      out.push(
        <View key={i} style={{ flexDirection: 'row', paddingLeft: li[1].length * 4 }}>
          <Text style={{ color: c.dim, width: 18 }}>{/\d/.test(li[2]) ? li[2] : '•'}</Text>
          <View style={{ flex: 1 }}><Inline text={li[3]} /></View>
        </View>,
      );
    else if (l.startsWith('> '))
      out.push(<View key={i} style={{ borderLeftWidth: 2, borderColor: c.line, paddingLeft: 8 }}><Inline text={l.slice(2)} style={{ color: c.dim }} /></View>);
    else if (l.trim()) out.push(<Inline key={i} text={l} />);
    else out.push(<View key={i} style={{ height: 6 }} />);
  }
  return <View>{out}</View>;
}
