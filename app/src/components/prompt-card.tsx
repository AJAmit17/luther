import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Markdown } from '@/components/markdown';
import { Icon, Press, Surface, Text, radius, space, tint, useTheme, type IconName } from '@/design';
import type { Prompt } from '@/lib/protocol';

// The agent needs you: a permission, a plan, or questions one at a time (multi-select
// collects until Done). The composer below doubles as "something else".
export function PromptCard({ p, more, answered, onChoose, onAnswer, onSkip }: {
  p: Prompt; more: number; answered: number; onChoose: (i: number) => void; onAnswer: (labels: string[]) => void; onSkip: () => void;
}) {
  const { color } = useTheme();
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
  const icon: IconName = p.kind === 'plan' ? 'list.bullet.clipboard' : p.kind === 'question' ? 'questionmark.bubble.fill' : 'hand.raised.fill';
  // The first option of a permission or plan is the go-ahead; the last is usually "no".
  const style = (i: number) => (q ? 'list' : i === 0 ? 'primary' : i === options.length - 1 && options.length > 1 ? 'deny' : 'quiet');

  return (
    <Surface style={{ padding: space.md + 2, gap: space.md, borderColor: tint(color.warn, 0.55), maxHeight: 460 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name={icon} size={16} color={color.warn} />
        <Text variant="headline" style={{ flex: 1 }} numberOfLines={2}>{q ? q.header || p.title : p.title}</Text>
        {total > 1 && <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>{answered + 1} of {total}</Text>}
        {more > 0 && <Text variant="caption">+{more} waiting</Text>}
      </View>
      <ScrollView style={{ flexGrow: 0, maxHeight: p.kind === 'plan' ? 260 : 150 }} showsVerticalScrollIndicator={false}>
        {q ? (
          <Text selectable variant="callout">{q.question}</Text>
        ) : p.kind === 'plan' ? (
          <Markdown text={p.body || ''} />
        ) : p.body ? (
          <View style={{ backgroundColor: color.bg, borderRadius: radius.control + 2, borderCurve: 'continuous', padding: space.sm + 2 }}>
            <Text selectable variant="caption" mono color="text" style={{ lineHeight: 17 }}>{p.body}</Text>
          </View>
        ) : null}
      </ScrollView>
      <View style={{ gap: space.xs + 2 }}>
        {options.map((o, i) => {
          const on = picked.includes(o.label);
          const s = style(i);
          const bg = on || s === 'primary' ? color.accent : s === 'deny' ? tint(color.red, 0.1) : color.muted;
          const fg = on || s === 'primary' ? color.onAccent : s === 'deny' ? color.red : color.text;
          return (
            <Press key={i} onPress={() => tap(i)} accessibilityRole="button" accessibilityState={q?.multiSelect ? { checked: on } : undefined} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, borderRadius: radius.control, borderCurve: 'continuous', paddingHorizontal: space.md + 2, paddingVertical: space.md - 1, backgroundColor: bg }}>
              {q?.multiSelect && <Icon name={on ? 'checkmark.circle.fill' : 'circle'} size={17} color={on ? color.onAccent : color.dim} />}
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="subhead" weight="medium" style={{ color: fg }}>{o.label}</Text>
                {!!o.desc && <Text variant="caption" style={{ color: on || s === 'primary' ? tint(color.onAccent, 0.9) : color.dim }}>{o.desc}</Text>}
              </View>
            </Press>
          );
        })}
      </View>
      {!!q && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Press onPress={onSkip} hitSlop={8} accessibilityRole="button">
            <Text variant="footnote">Skip</Text>
          </Press>
          {q.multiSelect && (
            <Press onPress={() => picked.length && onAnswer(picked)} hitSlop={8} accessibilityRole="button">
              <Text variant="subhead" weight="medium" color={picked.length ? 'accent' : 'faint'}>Done</Text>
            </Press>
          )}
        </View>
      )}
    </Surface>
  );
}
