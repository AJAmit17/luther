import { useMemo } from 'react';
import { Linking, ScrollView, StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import { Span, Surface, Text, space, tint, type, useTheme } from '@/design';

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

function Inline({ text, variant = 'callout', style }: { text: string; variant?: 'callout' | 'footnote' | 'title3' | 'headline'; style?: StyleProp<TextStyle> }) {
  const { color } = useTheme();
  return (
    <Text selectable variant={variant} color="text" style={[variant === 'callout' && { lineHeight: 23 }, style]}>
      {text.split(SPAN).map((p, i) => {
        if (!p) return null;
        if (p.startsWith('`') && p.endsWith('`') && p.length > 2)
          return <Span key={i} mono style={{ fontSize: type.subhead.fontSize, backgroundColor: tint(color.text, 0.07) }}>{p.slice(1, -1)}</Span>;
        if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <Span key={i} style={{ fontWeight: '600' }}>{p.slice(2, -2)}</Span>;
        if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <Span key={i} style={{ fontStyle: 'italic' }}>{p.slice(1, -1)}</Span>;
        // Only web links open: agent output can carry text from anywhere, and a
        // luther:// or other app scheme must not be one tap away.
        const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        const url = link ? (/^https?:\/\//i.test(link[2]) ? link[2] : null) : /^https?:\/\//.test(p) ? p : null;
        if (link && !url) return link[1];
        if (url)
          return (
            <Span key={i} color="accent" onPress={() => void Linking.openURL(url)} style={{ textDecorationLine: 'underline' }}>
              {link ? link[1] : p}
            </Span>
          );
        return p;
      })}
    </Text>
  );
}

function Piece({ b }: { b: Block }) {
  const { color } = useTheme();
  switch (b.kind) {
    case 'heading':
      return b.level === 1 ? (
        <Inline text={b.text} variant="title3" style={{ marginTop: space.xs }} />
      ) : b.level === 2 ? (
        <Inline text={b.text} variant="headline" style={{ marginTop: space.xs }} />
      ) : (
        <Inline text={b.text} style={{ fontWeight: '600', marginTop: space.xs }} />
      );
    case 'para':
      return <Inline text={b.text} />;
    case 'item':
      return (
        <View style={{ flexDirection: 'row', gap: space.sm, paddingLeft: b.indent * space.lg }}>
          <Text variant="callout" color="dim" style={{ lineHeight: 23, minWidth: 14, fontVariant: ['tabular-nums'] }}>{b.marker}</Text>
          <View style={{ flex: 1 }}>
            <Inline text={b.text} />
          </View>
        </View>
      );
    case 'quote':
      return (
        <View style={{ borderLeftWidth: 3, borderLeftColor: color.line, paddingLeft: space.md }}>
          <Inline text={b.text} style={{ color: color.dim }} />
        </View>
      );
    case 'rule':
      return <View style={{ height: 1, backgroundColor: color.line, marginVertical: space.xs }} />;
    case 'table':
      return (
        <Surface style={{ overflow: 'hidden' }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              {b.rows.map((r, i) => (
                <View key={i} style={{ flexDirection: 'row', borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: color.line, backgroundColor: i ? undefined : color.muted }}>
                  {r.map((cell, j) => (
                    <View key={j} style={{ width: 150, paddingHorizontal: space.sm + 2, paddingVertical: space.sm }}>
                      <Inline text={cell} variant="footnote" style={i ? undefined : { fontWeight: '600' }} />
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </Surface>
      );
    case 'code':
      return (
        <Surface style={{ backgroundColor: color.bg, overflow: 'hidden' }}>
          {!!b.lang && <Text variant="caption2" mono style={{ paddingHorizontal: space.md, paddingTop: space.sm }}>{b.lang}</Text>}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text selectable variant="footnote" mono color="text" style={{ lineHeight: 19, padding: space.md, paddingTop: b.lang ? space.xs : space.md }}>{b.text}</Text>
          </ScrollView>
        </Surface>
      );
  }
}

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parse(text), [text]);
  return (
    <View style={{ gap: space.sm + 2, alignSelf: 'stretch' }}>
      {blocks.map((b, i) => (
        <Piece key={i} b={b} />
      ))}
    </View>
  );
}
