import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Markdown } from '@/components/markdown';
import { Icon, c, mono } from '@/components/ui';
import type { Prompt } from '@/lib/protocol';

// permission/plan: tap an option. question: one at a time; multi-select collects
// labels until Done. The composer doubles as "something else".
export function PromptCard({ p, more, answered, onChoose, onAnswer, onSkip }: {
  p: Prompt; more: number; answered: number; onChoose: (i: number) => void; onAnswer: (labels: string[]) => void; onSkip: () => void;
}) {
  const q = p.kind === 'question' ? p.questions?.[answered] : undefined;
  const [picked, setPicked] = useState<string[]>([]); // reset by the parent's key
  const options = q ? q.options : p.options ?? [];
  const tap = (i: number) => {
    Haptics.selectionAsync();
    if (!q) return onChoose(i);
    const label = q.options[i].label;
    if (!q.multiSelect) return onAnswer([label]);
    setPicked((x) => (x.includes(label) ? x.filter((y) => y !== label) : [...x, label]));
  };

  return (
    <View style={{ borderTopWidth: 2, borderColor: c.accent as any, backgroundColor: c.card, padding: 14, gap: 10, maxHeight: '65%' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={p.kind === 'plan' ? 'list.bullet.clipboard' : p.kind === 'question' ? 'questionmark.bubble' : 'hand.raised'} color={c.accent} />
        <Text style={{ flex: 1, color: c.text, fontSize: 16, fontWeight: '600' }}>{q ? q.header || p.title : p.title}</Text>
        {more > 0 && <Text style={{ color: c.dim, fontSize: 12 }}>+{more} more</Text>}
      </View>
      <ScrollView style={{ flexGrow: 0, maxHeight: p.kind === 'plan' ? 280 : 160 }}>
        {q ? (
          <Text selectable style={{ color: c.text, fontSize: 15 }}>{q.question}</Text>
        ) : p.kind === 'plan' ? (
          <Markdown text={p.body || ''} />
        ) : (
          !!p.body && <Text selectable style={{ color: c.dim, fontSize: 12, fontFamily: mono }}>{p.body}</Text>
        )}
      </ScrollView>
      <View style={{ gap: 6 }}>
        {options.map((o, i) => {
          const on = picked.includes(o.label);
          return (
            <Pressable key={i} onPress={() => tap(i)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderCurve: 'continuous', paddingHorizontal: 12, paddingVertical: 11, backgroundColor: on ? c.accent : c.bg, opacity: pressed ? 0.6 : 1 })}>
              {q?.multiSelect && <Icon name={on ? 'checkmark.square.fill' : 'square'} color={on ? '#fff' : c.dim} />}
              <View style={{ flex: 1 }}>
                <Text style={{ color: on ? '#fff' : c.text, fontWeight: '600' }}>{o.label}</Text>
                {!!o.desc && <Text style={{ color: on ? '#fff' : c.dim, fontSize: 12, marginTop: 2 }}>{o.desc}</Text>}
              </View>
            </Pressable>
          );
        })}
      </View>
      {!!q && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable onPress={onSkip} hitSlop={8}><Text style={{ color: c.red }}>Skip</Text></Pressable>
          {q.multiSelect && (
            <Pressable onPress={() => picked.length && onAnswer(picked)} hitSlop={8}>
              <Text style={{ color: picked.length ? c.accent : c.dim, fontWeight: '600' }}>Done</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
