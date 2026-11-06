import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { api, currentHostIdSync } from '@/lib/hosts';
import type { Usage, UsageHistory } from '@/lib/protocol';
import { chartDays, formatTokens, providerTotals, tokenTotal, type TokenFormat } from '@/lib/usage';
import { UsageSection } from '@/components/usage-section';
import { Group, Icon, Note, ProviderIcon, ago, c, card, providerName, type, useLoad } from '@/components/ui';

const NUMBER_FORMAT_KEY = 'luther.usage-number-format';

function Breakdown({ usage, format }: { usage: Usage; format: TokenFormat }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
      {[
        ['Input', usage.inputTokens], ['Output', usage.outputTokens],
        ['Cache read', usage.cacheReadTokens ?? 0], ['Cache write', usage.cacheWriteTokens ?? 0],
      ].map(([label, value]) => <View key={label} style={{ gap: 3 }}><Text style={type.caption}>{label}</Text><Text style={[type.headline, { fontVariant: ['tabular-nums'] }]}>{formatTokens(Number(value), format)}</Text></View>)}
    </View>
  );
}

export default function UsageScreen() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [metric, setMetric] = useState<'tokens' | 'cost'>('tokens');
  const [numberFormat, setNumberFormat] = useState<TokenFormat>(() => {
    try {
      return SecureStore.getItem(NUMBER_FORMAT_KEY) === 'full' ? 'full' : 'compact';
    } catch {
      return 'compact';
    }
  });
  const [date, setDate] = useState<string | null>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const scrollable = chartWidth > 0 && contentWidth > chartWidth + 1;
  const host = currentHostIdSync();
  const { data, error, pull } = useLoad(() => host ? api<UsageHistory>(`/usage/history?days=${days}`) : Promise.resolve(null), [host, days], `usage-history-${days}`);
  const bars = chartDays(data?.days ?? [], metric);
  const selected = data?.days.find((d) => d.date === date) ?? data?.days.at(-1);
  const totals = providerTotals(data?.breakdown ?? []);
  const tokens = (n: number) => formatTokens(n, numberFormat);
  const chooseFormat = (format: TokenFormat) => {
    setNumberFormat(format);
    try {
      SecureStore.setItem(NUMBER_FORMAT_KEY, format);
    } catch {}
  };
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 22, paddingBottom: 48 }} refreshControl={<RefreshControl {...pull} />}>
      <Stack.Screen options={{ title: 'Usage' }} />
      {error ? <Note error>{error}</Note> : !host ? <Note>Pair a Mac to view its usage.</Note> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {([7, 30, 90] as const).map((n) => <Pressable key={n} accessibilityRole="button" accessibilityState={{ selected: days === n }} onPress={() => { setDays(n); setDate(null); }} style={[card, { flex: 1, padding: 10, alignItems: 'center', borderColor: n === days ? c.accent : c.line }]}><Text style={[type.subhead, { color: n === days ? c.accent : c.dim }]}>{n} days</Text></Pressable>)}
      </View>
      <View style={[card, { padding: 16, gap: 16 }]}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text style={type.caption}>LAST {days} DAYS · THIS MAC</Text>
          <View style={{ flexDirection: 'row', backgroundColor: c.muted, borderRadius: 8, padding: 2 }}>
            {(['compact', 'full'] as const).map((format) => <Pressable key={format} accessibilityRole="button" accessibilityLabel={format === 'compact' ? 'Compact token counts' : 'Full token counts'} accessibilityState={{ selected: numberFormat === format }} onPress={() => chooseFormat(format)} style={{ paddingHorizontal: 8, paddingVertical: 7, borderRadius: 6, backgroundColor: numberFormat === format ? c.card : 'transparent' }}><Text style={[type.caption, { color: numberFormat === format ? c.accent : c.dim }]}>{format === 'compact' ? 'Compact' : 'Full'}</Text></Pressable>)}
          </View>
        </View>
        <Text style={type.title}>{tokens(tokenTotal(data?.total ?? { inputTokens: 0, outputTokens: 0 }))} tokens</Text>
        <Text style={type.footnote}>{data?.total.costReported ? `$${(data.total.costUsd ?? 0).toFixed(2)} reported cost (partial coverage)` : 'Cost unavailable · no estimated charges'}</Text>
        {data ? <Breakdown usage={data.total} format={numberFormat} /> : null}
      </View>
      <Group title="Daily burn" footer={data ? `Updated ${ago(data.updated)} ago · tap a day for its breakdown` : 'Loading token history…'}>
        <View style={{ padding: 16, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 18 }}>
              {(['tokens', 'cost'] as const).map((m) => <Pressable key={m} accessibilityRole="button" accessibilityState={{ selected: metric === m }} onPress={() => setMetric(m)}><Text style={[type.subhead, { color: metric === m ? c.accent : c.dim }]}>{m === 'tokens' ? 'Tokens' : 'Reported cost'}</Text></Pressable>)}
            </View>
            {scrollable ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="arrow.left.and.right" size={11} color={c.faint} /><Text style={[type.caption, { color: c.faint }]}>Swipe</Text></View> : null}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={scrollable} onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)} onContentSizeChange={(width) => setContentWidth(width)} accessibilityHint={scrollable ? 'Swipe horizontally to see more days. Tap a bar for its breakdown.' : 'Tap a bar for its breakdown.'} contentContainerStyle={{ flexGrow: 1, gap: days === 7 ? 16 : 5, alignItems: 'flex-end', height: 145 }}>
            {bars.map(({ day, value, fraction }) => <Pressable key={day.date} accessibilityRole="button" accessibilityLabel={`${day.date}: ${metric === 'tokens' ? `${value} tokens` : `$${value.toFixed(4)} reported`}`} onPress={() => setDate(day.date)} style={{ minWidth: days === 7 ? 24 : 12, flex: 1, height: 140, justifyContent: 'flex-end', gap: 6 }}>
              <View style={{ height: value ? Math.max(3, fraction * 115) : 1, backgroundColor: day.date === selected?.date ? c.blue : value ? c.accent : c.line, borderRadius: 3 }} />
              {(days === 7 || day.date.endsWith('01')) ? <Text style={type.caption2}>{Number(day.date.slice(-2))}</Text> : <View style={{ height: 13 }} />}
            </Pressable>)}
          </ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={type.caption}>{data?.days[0]?.date}</Text><Text style={type.caption}>{data?.days.at(-1)?.date}</Text></View>
          {selected ? <View style={{ gap: 10 }}><Text style={type.headline}>{selected.date} · {tokens(tokenTotal(selected))} tokens</Text><Breakdown usage={selected} format={numberFormat} /></View> : null}
          {data && !tokenTotal(data.total) ? <Note>No token usage reported in this period.</Note> : null}
          {metric === 'cost' && !data?.total.costReported ? <Note>These agents have not reported costs. A zero bar does not mean usage was free.</Note> : null}
        </View>
      </Group>
      <Group title="Agents and models" footer="No row means no token counts are available for this period; it does not mean the agent was unused.">
        {!totals.length ? <Note>No reported tokens yet.</Note> : totals.map((u) => <View key={u.provider} style={{ padding: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><ProviderIcon p={u.provider} size={28} /><Text style={[type.headline, { flex: 1 }]}>{providerName(u.provider)}</Text><Text style={type.subhead}>{tokens(tokenTotal(u))}</Text></View>
          <Breakdown usage={u} format={numberFormat} />
          {data?.breakdown.filter((b) => b.provider === u.provider).map((b) => <View key={b.model ?? ''} style={{ flexDirection: 'row', gap: 8, justifyContent: 'space-between' }}><Text style={[type.footnote, { flex: 1 }]}>{b.model || (b.costReported && !tokenTotal(b) ? 'Unitemized turn cost' : 'Model not reported')}</Text><Text style={type.footnote}>{tokens(tokenTotal(b))} · {b.costReported ? `$${(b.costUsd ?? 0).toFixed(2)}` : 'Cost unavailable'}</Text></View>)}
        </View>)}
      </Group>
      {host ? <UsageSection refresh={data?.updated} /> : null}
      {data?.notes.map((note) => <Text key={note} style={type.footnote}>{note}</Text>)}
    </ScrollView>
  );
}
