import { useMemo } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { c, card, mono, tint, type, useHex } from '@/components/ui';

// An agent reply, block by block: headings, paragraphs, lists, quotes, code
// fences, and inline `code`, **bold**, *italic*, [links](url) and bare URLs.

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'item'; marker: string; indent: number; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'rule' };

function parse(src: string): Block[] {
  const out: Block[] = [];
  const lines = src.replace(/\r/g, '').split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: 'para', text: para.join(' ') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = l.match(/^\s*```(\S*)/);
    if (fence) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      out.push({ kind: 'code', lang: fence[1], text: code.join('\n') });
      continue;
    }
    if (/^\s*\|/.test(l)) {
      // A table: consecutive | lines; the |---| line under the header is dropped.
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
        if (/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i])) continue;
        rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim()));
      }
      i--;
      out.push({ kind: 'table', rows });
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)/);
    const li = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/);
    if (h) {
      flush();
      out.push({ kind: 'heading', level: h[1].length, text: h[2] });
    } else if (li) {
      flush();
      out.push({ kind: 'item', indent: Math.min(3, Math.floor(li[1].length / 2)), marker: /\d/.test(li[2]) ? li[2].replace(')', '.') : '•', text: li[3] });
    } else if (/^\s*>/.test(l)) {
      flush();
      out.push({ kind: 'quote', text: l.replace(/^\s*>\s?/, '') });
    } else if (/^\s*([-*_])\1{2,}\s*$/.test(l)) {
      flush();
      out.push({ kind: 'rule' });
    } else if (!l.trim()) flush();
    else para.push(l.trim());
  }
  flush();
  return out;
}

const SPAN = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s)]+)/g;

function Inline({ text, style }: { text: string; style?: TextStyle | TextStyle[] }) {
  useHex();
  return (
    <Text selectable style={[type.callout, { lineHeight: 23 }, style]}>
      {text.split(SPAN).map((p, i) => {
        if (!p) return null;
        if (p.startsWith('`') && p.endsWith('`') && p.length > 2)
          return <Text key={i} style={{ fontFamily: mono, fontSize: 14, backgroundColor: tint('text', 0.07), color: c.text }}>{p.slice(1, -1)}</Text>;
        if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <Text key={i} style={{ fontWeight: '700' }}>{p.slice(2, -2)}</Text>;
        if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <Text key={i} style={{ fontStyle: 'italic' }}>{p.slice(1, -1)}</Text>;
        // Only web links open: agent output can carry text from anywhere, and a
        // luther:// or other app scheme must not be one tap away.
        const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        const url = link ? (/^https?:\/\//i.test(link[2]) ? link[2] : null) : /^https?:\/\//.test(p) ? p : null;
        if (link && !url) return link[1];
        if (url)
          return (
            <Text key={i} onPress={() => void Linking.openURL(url)} style={{ color: c.accent, textDecorationLine: 'underline' }}>
              {link ? link[1] : p}
            </Text>
          );
        return p;
      })}
    </Text>
  );
}

function Piece({ b }: { b: Block }) {
  useHex();
  switch (b.kind) {
    case 'heading':
      return <Inline text={b.text} style={[b.level === 1 ? type.title3 : b.level === 2 ? type.headline : { ...type.callout, fontWeight: '600' }, { marginTop: 4 }]} />;
    case 'para':
      return <Inline text={b.text} />;
    case 'item':
      return (
        <View style={{ flexDirection: 'row', gap: 8, paddingLeft: b.indent * 16 }}>
          <Text style={[type.callout, { color: c.dim, lineHeight: 23, minWidth: 14, fontVariant: ['tabular-nums'] }]}>{b.marker}</Text>
          <View style={{ flex: 1 }}>
            <Inline text={b.text} />
          </View>
        </View>
      );
    case 'quote':
      return (
        <View style={{ borderLeftWidth: 3, borderLeftColor: c.line, paddingLeft: 12 }}>
          <Inline text={b.text} style={{ color: c.dim }} />
        </View>
      );
    case 'rule':
      return <View style={{ height: 1, backgroundColor: c.line, marginVertical: 4 }} />;
    case 'table':
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[card, { overflow: 'hidden' }]}>
          <View>
            {b.rows.map((r, i) => (
              <View key={i} style={{ flexDirection: 'row', borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.line, backgroundColor: i ? undefined : c.muted }}>
                {r.map((cell, j) => (
                  <View key={j} style={{ width: 150, paddingHorizontal: 10, paddingVertical: 8 }}>
                    <Inline text={cell} style={[type.footnote, { color: c.text, lineHeight: 18 }, i ? {} : { fontWeight: '600' }]} />
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    case 'code':
      return (
        <View style={[card, { backgroundColor: c.bg, overflow: 'hidden' }]}>
          {!!b.lang && <Text style={[type.caption2, { fontFamily: mono, paddingHorizontal: 12, paddingTop: 8 }]}>{b.lang}</Text>}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text selectable style={{ fontFamily: mono, fontSize: 13, lineHeight: 19, color: c.text, padding: 12, paddingTop: b.lang ? 4 : 12 }}>{b.text}</Text>
          </ScrollView>
        </View>
      );
  }
}

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parse(text), [text]);
  return (
    <View style={{ gap: 10, alignSelf: 'stretch' }}>
      {blocks.map((b, i) => (
        <Piece key={i} b={b} />
      ))}
    </View>
  );
}
