import { View } from 'react-native';
import { Group, radius, space, Span, Text, useTheme } from '@/design';
import { AgentTile, agentName } from '@/features/agents';
import { until, since } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import { api, currentHostIdSync } from '@/lib/hosts';
import type { Limits } from '@/lib/protocol';

/** Group's header and footer around free-form card content (Group itself holds only ListItems). */
// Each agent's plan windows: how much is used and when it resets, asked fresh
// (Claude at Anthropic's usage endpoint, Codex over its app-server).
export function UsageSection({ refresh }: { refresh?: number }) {
  const { color } = useTheme();
  const host = currentHostIdSync();
  const { data, error } = useLoad(() => api<Limits[]>('/usage'), [host, refresh], 'usage');
  if (!data?.length && !error) return null;
  return (
    <Group title="Usage" footer={error || 'Asked fresh each time you open this: Claude from Anthropic, Codex from its own server.'}>
      {data?.map((l, i) => (
        <View key={l.provider} style={{ padding: space.lg, gap: space.sm + 2, borderTopWidth: i ? 1 : 0, borderTopColor: color.line }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + 2 }}>
            <AgentTile p={l.provider} size={26} />
            <Text variant="headline" style={{ flex: 1 }}>
              {agentName(l.provider)}
              {l.plan ? <Span color="dim" weight="regular"> · {l.plan}</Span> : null}
            </Text>
            <Text variant="caption">{since(l.updated)}</Text>
          </View>
          {l.windows.map((w) => (
            <View key={w.label} style={{ gap: 5 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="footnote">{w.label}</Text>
                <Text variant="footnote" style={{ fontVariant: ['tabular-nums'] }}>
                  {Math.round(w.used)}%{w.resetsAt ? ` · resets ${until(w.resetsAt)}` : ''}
                </Text>
              </View>
              <View style={{ height: 6, borderRadius: radius.full, backgroundColor: color.muted, overflow: 'hidden' }}>
                <View style={{ width: `${Math.min(100, Math.max(0, w.used))}%`, height: 6, borderRadius: radius.full, backgroundColor: w.used >= 90 ? color.red : w.used >= 70 ? color.accent : color.green }} />
              </View>
            </View>
          ))}
        </View>
      ))}
    </Group>
  );
}
