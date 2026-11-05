import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Markdown } from '@/components/markdown';
import { Icon, c, card, mono, tint, type } from '@/components/ui';
import type { Prompt } from '@/lib/protocol';

// The agent needs you: a permission, a plan to approve, or questions (one at a
// time; multi-select collects until Done). The composer below doubles as
// "something else".
export function PromptCard({ p, more, answered, onChoose, onAnswer, onSkip }: {
  p: Prompt; more: number; answered: number; onChoose: (i: number) => void; onAnswer: (labels: string[]) => void; onSkip: () => void;
}) {
  const q = p.kind === 'question' ? p.questions?.[answered] : undefined;
  const total = p.questions?.length ?? 0;
  const [picked, setPicked] = useState<string[]>([]); // reset by the parent's key
  const options = q ? q.options : p.options ?? [];
  const tap = (i: number) => {
    void Haptics.selectionAsync();
    if (!q) return onChoose(i);
    const label = q.options[i].label;
    if (!q.multiSelect) return onAnswer([label]);
    setPicked((x) => (x.includes(label) ? x.filter((y) => y !== label) : [...x, label]));
  };
  const icon = p.kind === 'plan' ? 'list.bullet.clipboard' : p.kind === 'question' ? 'questionmark.bubble.fill' : 'hand.raised.fill';
  // The first option of a permission or plan is the go-ahead; the last is usually "no".
  const style = (i: number) => (q ? 'list' : i === 0 ? 'primary' : i === options.length - 1 && options.length > 1 ? 'deny' : 'quiet');

  return (
    <View style={[card, { padding: 14, gap: 12, borderColor: tint('accent', 0.55), borderWidth: 1, maxHeight: 460 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={icon} size={16} color={c.accent} />
        <Text style={[type.headline, { flex: 1 }]} numberOfLines={2}>{q ? q.header || p.title : p.title}</Text>
        {total > 1 && <Text style={[type.caption, { fontVariant: ['tabular-nums'] }]}>{answered + 1} of {total}</Text>}
        {more > 0 && <Text style={type.caption}>+{more} waiting</Text>}
      </View>
      <ScrollView style={{ flexGrow: 0, maxHeight: p.kind === 'plan' ? 260 : 150 }} showsVerticalScrollIndicator={false}>
        {q ? (
          <Text selectable style={type.callout}>{q.question}</Text>
        ) : p.kind === 'plan' ? (
          <Markdown text={p.body || ''} />
        ) : p.body ? (
          <View style={{ backgroundColor: c.bg, borderRadius: 10, borderCurve: 'continuous', padding: 10 }}>
            <Text selectable style={{ fontFamily: mono, fontSize: 12, lineHeight: 17, color: c.text }}>{p.body}</Text>
          </View>
        ) : null}
      </ScrollView>
      <View style={{ gap: 6 }}>
        {options.map((o, i) => {
          const on = picked.includes(o.label);
          const s = style(i);
          const bg = on || s === 'primary' ? c.accent : s === 'deny' ? tint('red', 0.1) : c.muted;
          const fg = on || s === 'primary' ? '#FFFFFF' : s === 'deny' ? c.red : c.text;
          return (
            <Pressable key={i} onPress={() => tap(i)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderCurve: 'continuous', paddingHorizontal: 14, paddingVertical: 11, backgroundColor: bg, opacity: pressed ? 0.7 : 1 })}>
              {q?.multiSelect && <Icon name={on ? 'checkmark.circle.fill' : 'circle'} size={17} color={on ? '#FFFFFF' : c.dim} />}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.subhead, { fontWeight: '600', color: fg }]}>{o.label}</Text>
                {!!o.desc && <Text style={[type.caption, { color: on || s === 'primary' ? '#FFFFFFCC' : c.dim }]}>{o.desc}</Text>}
              </View>
            </Pressable>
          );
        })}
      </View>
      {!!q && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable onPress={onSkip} hitSlop={8}>
            <Text style={[type.footnote, { color: c.dim }]}>Skip</Text>
          </Pressable>
          {q.multiSelect && (
            <Pressable onPress={() => picked.length && onAnswer(picked)} hitSlop={8}>
              <Text style={[type.subhead, { color: picked.length ? c.accent : c.faint, fontWeight: '600' }]}>Done</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
