import { Text, View } from 'react-native';
import { api } from '@/lib/hosts';
import type { Limits } from '@/lib/protocol';
import { Note, Section, ago, c, providerName, until, useLoad } from '@/components/ui';

// Each agent's plan usage on the Mac: how much of each window is used and when
// it resets. Claude reports it during turns (so it can be a while old); Codex is
// asked fresh.
export function UsageSection() {
  const { data, error } = useLoad(() => api<Limits[]>('/usage'), [], 'usage');
  return (
    <>
      <Section title="Usage" />
      {!!error && <Note error>{error}</Note>}
      {data && !data.length && <Note>No usage reported yet. Claude reports it during a turn.</Note>}
      {data?.map((l) => (
        <View key={l.provider} style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
          <Text style={{ color: c.text, fontWeight: '600' }}>
            {providerName(l.provider)}
            {l.plan ? <Text style={{ color: c.dim, fontWeight: '400' }}> · {l.plan}</Text> : null}
            <Text style={{ color: c.faint, fontWeight: '400', fontSize: 12 }}>  {ago(l.updated)} ago</Text>
          </Text>
          {l.windows.map((w) => (
            <View key={w.label} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.dim, fontSize: 13 }}>{w.label}</Text>
                <Text style={{ color: c.dim, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                  {Math.round(w.used)}%{w.resetsAt ? ` · resets ${until(w.resetsAt)}` : ''}
                </Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: c.fill }}>
                <View style={{ width: `${Math.min(100, Math.max(0, w.used))}%`, height: 6, borderRadius: 3, backgroundColor: w.used >= 90 ? c.red : w.used >= 70 ? c.accent : c.green }} />
              </View>
            </View>
          ))}
        </View>
      ))}
    </>
  );
}
