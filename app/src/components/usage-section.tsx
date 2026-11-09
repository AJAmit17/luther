import { Text, View } from 'react-native';
import { api, currentHostIdSync } from '@/lib/hosts';
import type { Limits } from '@/lib/protocol';
import { Group, ProviderIcon, ago, c, providerName, type, until, useLoad, useHex } from '@/components/ui';

// Each agent's plan usage on the Mac: how much of each window is used and when
// it resets. Asked fresh (Claude at Anthropic's usage endpoint, as its own
// /usage does; Codex over its app-server). A second Claude account (the desktop
// app's) gets its own row; the CLI login is then labelled Terminal.
export function UsageSection({ refresh }: { refresh?: number }) {
  useHex();
  const host = currentHostIdSync();
  const { data, error } = useLoad(() => api<Limits[]>('/usage'), [host, refresh], 'usage');
  if (!data?.length && !error) return null;
  return (
    <Group title="Usage" footer={error || 'Asked fresh each time you open this: Claude from Anthropic (the desktop app\'s account from the app\'s own samples), Codex from its own server.'}>
      {data?.map((l, i) => (
        <View key={l.provider + (l.account ?? '')} style={{ padding: 16, gap: 10, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <ProviderIcon p={l.provider} size={26} />
            <Text style={[type.headline, { flex: 1 }]}>
              {providerName(l.provider)}
              {accountLabel(l, data ?? []) ? <Text style={[type.subhead, { color: c.dim, fontWeight: '400' }]}> · {accountLabel(l, data ?? [])}</Text> : null}
              {l.plan ? <Text style={[type.subhead, { color: c.dim, fontWeight: '400' }]}> · {l.plan}</Text> : null}
            </Text>
            <Text style={type.caption}>{ago(l.updated)} ago</Text>
          </View>
          {l.windows.map((w) => (
            <View key={w.label} style={{ gap: 5 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={type.footnote}>{w.label}</Text>
                <Text style={[type.footnote, { fontVariant: ['tabular-nums'] }]}>
                  {Math.round(w.used)}%{w.resetsAt ? ` · resets ${until(w.resetsAt)}` : ''}
                </Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: c.muted, overflow: 'hidden' }}>
                <View style={{ width: `${Math.min(100, Math.max(0, w.used))}%`, height: 6, borderRadius: 3, backgroundColor: w.used >= 90 ? c.red : w.used >= 70 ? c.accent : c.green }} />
              </View>
            </View>
          ))}
        </View>
      ))}
    </Group>
  );
}

// accountLabel: the entry's account, or "Terminal" for the CLI login when the
// same agent has another account on this Mac.
function accountLabel(l: Limits, all: Limits[]) {
  return l.account ?? (all.some((o) => o.provider === l.provider && o.account) ? 'Terminal' : undefined);
}
