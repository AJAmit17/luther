import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { api, currentHostIdSync } from '@/lib/hosts';
import type { Usage, UsageHistory } from '@/lib/protocol';
import { chartDays, formatTokens, providerTotals, tokenTotal, type TokenFormat } from '@/lib/usage';
import { UsageSection } from '@/components/usage-section';
import { Group, Icon, LargeTitle, Note, Press, Segmented, space, Surface, Text, useTheme } from '@/design';
import { AgentTile, agentName } from '@/features/agents';
import { since } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import { ClaudeAccountSection } from '@/components/claude-account-section';

const NUMBER_FORMAT_KEY = 'luther.usage-number-format';

function Breakdown({ usage, format }: { usage: Usage; format: TokenFormat }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md + 2 }}>
      {[
        ['Input', usage.inputTokens], ['Output', usage.outputTokens],
        ['Cache read', usage.cacheReadTokens ?? 0], ['Cache write', usage.cacheWriteTokens ?? 0],
      ].map(([label, value]) => <View key={label} style={{ gap: 3 }}><Text variant="caption">{label}</Text><Text variant="headline" style={{ fontVariant: ['tabular-nums'] }}>{formatTokens(Number(value), format)}</Text></View>)}
    </View>
  );
}

export default function UsageScreen() {
  const { color } = useTheme();
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
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxl + space.lg }} refreshControl={<RefreshControl {...pull} />}>
      <Stack.Screen options={{ title: 'Usage' }} />
      <LargeTitle>Usage</LargeTitle>
      {error ? <Note tone="danger">{error}</Note> : !host ? <Note>Pair a Mac to view its usage.</Note> : null}
      <Segmented options={([7, 30, 90] as const).map((n) => ({ id: n, label: `${n} Days` }))} value={days} onChange={(n) => { setDays(n); setDate(null); }} />
      <Surface style={{ padding: space.lg, gap: space.lg }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
          <Text variant="caption">LAST {days} DAYS · THIS MAC</Text>
          <View style={{ width: 150 }}>
            <Segmented small options={[{ id: 'compact' as const, label: 'Compact' }, { id: 'full' as const, label: 'Full' }]} value={numberFormat} onChange={chooseFormat} />
          </View>
        </View>
        <Text variant="title">{tokens(tokenTotal(data?.total ?? { inputTokens: 0, outputTokens: 0 }))} tokens</Text>
        <Text variant="footnote">{data?.total.costReported ? `$${(data.total.costUsd ?? 0).toFixed(2)} reported cost (partial coverage)` : 'Cost unavailable · no estimated charges'}</Text>
        {data ? <Breakdown usage={data.total} format={numberFormat} /> : null}
      </Surface>
      <Group title="Daily Burn" footer={data ? `Updated ${since(data.updated)} · tap a day for its breakdown` : 'Loading token history…'}>
        <View style={{ padding: space.lg, gap: space.md + 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
            <View style={{ width: 170 }}>
              <Segmented small options={[{ id: 'tokens' as const, label: 'Tokens' }, { id: 'cost' as const, label: 'Cost' }]} value={metric} onChange={setMetric} />
            </View>
            {scrollable ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}><Icon name="arrow.left.and.right" size={11} color={color.faint} /><Text variant="caption" color="faint">Swipe</Text></View> : null}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={scrollable} onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)} onContentSizeChange={(width) => setContentWidth(width)} accessibilityHint={scrollable ? 'Swipe horizontally to see more days. Tap a bar for its breakdown.' : 'Tap a bar for its breakdown.'} contentContainerStyle={{ flexGrow: 1, gap: days === 7 ? space.lg : 5, alignItems: 'flex-end', height: 145 }}>
            {bars.map(({ day, value, fraction }) => <Press key={day.date} scale={0.96} accessibilityRole="button" accessibilityLabel={`${day.date}: ${metric === 'tokens' ? `${value} tokens` : `$${value.toFixed(4)} reported`}`} onPress={() => setDate(day.date)} style={{ minWidth: days === 7 ? 24 : 12, flex: 1, height: 140, justifyContent: 'flex-end', gap: space.xs + 2 }}>
              <View style={{ height: value ? Math.max(3, fraction * 115) : 1, backgroundColor: day.date === selected?.date ? color.blue : value ? color.accent : color.line, borderRadius: 3 }} />
              {(days === 7 || day.date.endsWith('01')) ? <Text variant="caption2">{Number(day.date.slice(-2))}</Text> : <View style={{ height: 13 }} />}
            </Press>)}
          </ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="caption">{data?.days[0]?.date}</Text><Text variant="caption">{data?.days.at(-1)?.date}</Text></View>
          {selected ? <View style={{ gap: space.sm + 2 }}><Text variant="headline">{selected.date} · {tokens(tokenTotal(selected))} tokens</Text><Breakdown usage={selected} format={numberFormat} /></View> : null}
          {data && !tokenTotal(data.total) ? <Note>No token usage reported in this period.</Note> : null}
          {metric === 'cost' && !data?.total.costReported ? <Note>These agents have not reported costs. A zero bar does not mean usage was free.</Note> : null}
        </View>
      </Group>
      <Group title="Agents and Models" footer="No row means no token counts are available for this period; it does not mean the agent was unused.">
        {!totals.length ? <Note>No reported tokens yet.</Note> : totals.map((u, i) => <View key={u.provider} style={{ padding: space.lg, gap: space.sm + 2, borderTopWidth: i ? 1 : 0, borderTopColor: color.line }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + 2 }}><AgentTile p={u.provider} size={28} /><Text variant="headline" style={{ flex: 1 }}>{agentName(u.provider)}</Text><Text variant="subhead">{tokens(tokenTotal(u))}</Text></View>
          <Breakdown usage={u} format={numberFormat} />
          {data?.breakdown.filter((b) => b.provider === u.provider).map((b) => <View key={b.model ?? ''} style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'space-between' }}><Text variant="footnote" style={{ flex: 1 }}>{b.model || (b.costReported && !tokenTotal(b) ? 'Unitemized turn cost' : 'Model not reported')}</Text><Text variant="footnote">{tokens(tokenTotal(b))} · {b.costReported ? `$${(b.costUsd ?? 0).toFixed(2)}` : 'Cost unavailable'}</Text></View>)}
        </View>)}
      </Group>
      {host ? <UsageSection refresh={data?.updated} /> : null}
      {host ? <ClaudeAccountSection /> : null}
      {data?.notes.map((note) => <Text key={note} variant="footnote">{note}</Text>)}
    </ScrollView>
  );
}
