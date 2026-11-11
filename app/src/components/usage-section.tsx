import { View } from 'react-native';
import { Group, radius, space, Span, Text, useTheme } from '@/design';
import { AgentTile, agentName } from '@/features/agents';
import { until, since } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import { api, currentHostIdSync } from '@/lib/hosts';
import type { Limits } from '@/lib/protocol';

// Each agent's plan windows, asked fresh (Claude at Anthropic's usage endpoint, Codex over its app-server).
// A second Claude account (the desktop app's) gets its own row; the CLI login is then labelled Terminal.
export function UsageSection({ refresh }: { refresh?: number }) {
  const { color } = useTheme();
  const host = currentHostIdSync();
  const { data, error } = useLoad(() => api<Limits[]>('/usage'), [host, refresh], 'usage');
  if (!data?.length && !error) return null;
  return (
    <Group title="Usage" footer={error || 'Asked fresh each time you open this: Claude from Anthropic (the desktop app\'s account from the app\'s own samples), Codex from its own server.'}>
      {data?.map((l, i) => (
        <View key={l.provider + (l.account ?? '')} style={{ padding: space.lg, gap: space.sm + 2, borderTopWidth: i ? 1 : 0, borderTopColor: color.line }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + 2 }}>
            <AgentTile p={l.provider} size={26} />
            <Text variant="headline" style={{ flex: 1 }}>
              {agentName(l.provider)}
              {accountLabel(l, data ?? []) ? <Span color="dim" weight="regular"> · {accountLabel(l, data ?? [])}</Span> : null}
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

/** The entry's account, or "Terminal" for the CLI login when the same agent has another account here. */
function accountLabel(l: Limits, all: Limits[]) {
  return l.account ?? (all.some((o) => o.provider === l.provider && o.account) ? 'Terminal' : undefined);
}
