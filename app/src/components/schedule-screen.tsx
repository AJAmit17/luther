import { useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api, post } from '@/lib/hosts';
import type { Job, Mode, Project, Provider, ProviderInfo } from '@/lib/protocol';
import { DAYS, describe, fromCron, parseTime, toCron, type Preset } from '@/lib/cron';
import { peek } from '@/lib/cache';
import { Button, Icon, MODES, Note, c, home, mono, useLoad, ProviderMark, useHex } from '@/components/ui';

const Chip = ({ label, on, onPress, icon, mark }: { label: string; on: boolean; onPress: () => void; icon?: string; mark?: React.ReactNode }) => {
  useHex();
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: on ? c.accent : c.card }}>
      {mark ?? (!!icon && <Icon name={icon} size={13} color={on ? c.onAccent : c.text} />)}
      <Text style={{ color: on ? c.onAccent : c.text, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
};
const Label = ({ children }: { children: string }) => {
  useHex();
  return <Text style={{ color: c.dim, fontWeight: '600', fontSize: 13 }}>{children}</Text>;
};

// Prompts that make good unattended runs.
const STARTERS = [
  { name: 'Health report', prompt: 'Give me a short health report of this repository: failing or flaky tests, build warnings, recent TODOs, and anything that looks broken. Don’t change any files.' },
  { name: 'Fix failing tests', prompt: 'Run the test suite. If anything fails, find the cause and fix it, then run the suite again. Report what failed and what you changed.' },
  { name: 'Dependency check', prompt: 'List outdated or vulnerable dependencies using the package manager’s own audit and outdated commands, and what each upgrade would involve. Don’t upgrade anything.' },
  { name: 'Docs drift', prompt: 'Compare the README and docs with the code. List what is out of date or missing, and fix the docs where you are sure.' },
  { name: 'Security review', prompt: 'Review the code changed in the last day (git log --since=1.day) for security problems: injection, secrets in code, unsafe input handling. Report each with file and line. Don’t change any files.' },
];

// One schedule: what to run, where, with which agent, and when.
export default function ScheduleEditor() {
  useHex();
  const input = { color: c.text, backgroundColor: c.card, borderRadius: 12, borderCurve: 'continuous', padding: 12, fontSize: 16 } as const;
  const params = useLocalSearchParams<{ id?: string; cwd?: string }>();
  const existing = params.id ? peek<Job[]>('schedules:[]')?.find((j) => j.id === params.id) : undefined;
  const start = fromCron(existing?.cron ?? '0 9 * * 1-5');
  const [name, setName] = useState(existing?.name ?? '');
  const [prompt, setPrompt] = useState(existing?.prompt ?? '');
  const [cwd, setCwd] = useState(existing?.cwd ?? params.cwd ?? '');
  const [provider, setProvider] = useState<Provider | null>(existing?.provider ?? null);
  // Runs are unattended: in Ask mode every edit would be declined, so new ones start in Edits, in their own worktree.
  const [mode, setMode] = useState<Mode>(existing?.mode ?? 'edits');
  const [worktree, setWorktree] = useState(existing?.worktree ?? true);
  const [preset, setPreset] = useState<Preset>(start.preset);
  const [time, setTime] = useState(start.time);
  const [day, setDay] = useState(start.day);
  const [custom, setCustom] = useState(existing?.cron ?? '0 9 * * 1-5');
  const [busy, setBusy] = useState(false);
  const { data: providers } = useLoad(() => api<ProviderInfo[]>('/providers'), [], 'providers');
  const { data: projects } = useLoad(() => api<Project[]>('/projects'), [], 'projects');
  const installed = (providers ?? []).filter((p) => p.installed);
  const agent = provider ?? installed[0]?.id ?? null;
  const cron = preset === 'custom' ? custom.trim() : toCron(preset, time, day);
  const timeOk = preset === 'custom' || preset === 'hourly' || !!parseTime(time);

  const save = () => {
    setBusy(true);
    const job: Partial<Job> = { ...existing, name, prompt, cwd, provider: agent!, mode, worktree, cron, enabled: existing?.enabled ?? true };
    post('/schedules', job).then(() => router.back(), (e) => Alert.alert('Could not save', e.message)).finally(() => setBusy(false));
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg as any }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: existing ? 'Edit schedule' : 'New schedule' }} />
      <Label>WHAT TO DO</Label>
      <TextInput style={[input, { minHeight: 100 }]} value={prompt} onChangeText={setPrompt} placeholder="e.g. Run the test suite and fix anything that fails" placeholderTextColor={c.dim} multiline />
      {!existing && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {STARTERS.map((x) => (
            <Chip key={x.name} label={x.name} on={prompt === x.prompt} onPress={() => { setPrompt(x.prompt); if (!name) setName(x.name); }} />
          ))}
        </ScrollView>
      )}
      <TextInput style={input} value={name} onChangeText={setName} placeholder="Name (optional)" placeholderTextColor={c.dim} />

      <Label>WHEN</Label>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {(['hourly', 'daily', 'weekdays', 'weekly', 'custom'] as const).map((p) => (
          <Chip key={p} label={p[0].toUpperCase() + p.slice(1)} on={preset === p} onPress={() => setPreset(p)} />
        ))}
      </View>
      {preset === 'weekly' && (
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {DAYS.map((d, i) => <Chip key={d} label={d.slice(0, 3)} on={day === i} onPress={() => setDay(i)} />)}
        </View>
      )}
      {preset === 'custom' ? (
        <TextInput style={[input, { fontFamily: mono }]} value={custom} onChangeText={setCustom} placeholder="minute hour day month weekday" placeholderTextColor={c.dim} autoCapitalize="none" autoCorrect={false} />
      ) : preset !== 'hourly' ? (
        <TextInput style={[input, { fontFamily: mono, width: 110 }]} value={time} onChangeText={setTime} placeholder="09:00" placeholderTextColor={c.dim} keyboardType="numbers-and-punctuation" />
      ) : null}
      <Text style={{ color: timeOk ? c.dim : c.red, fontSize: 13 }}>{timeOk ? `${describe(cron)}, in the Mac's time zone, while it's awake.` : 'Time as HH:MM, 24-hour.'}</Text>

      <Label>PROJECT</Label>
      {projects ? (
        <View style={{ gap: 6 }}>
          {projects.map((p) => (
            <Pressable key={p.cwd} onPress={() => setCwd(p.cwd)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 12, borderCurve: 'continuous', backgroundColor: cwd === p.cwd ? c.fill : c.card }}>
              <Icon name="folder" color={c.blue} />
              <Text style={{ color: c.text, flex: 1 }} numberOfLines={1}>{p.name} <Text style={{ color: c.dim, fontSize: 12 }}>{home(p.cwd)}</Text></Text>
              {cwd === p.cwd && <Icon name="checkmark" color={c.accent} />}
            </Pressable>
          ))}
        </View>
      ) : (
        <Note>Loading projects…</Note>
      )}

      <Label>AGENT</Label>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {installed.map((p) => <Chip key={p.id} label={p.name} mark={<ProviderMark p={p.id} size={14} color={agent === p.id ? c.onAccent : undefined} />} on={agent === p.id} onPress={() => setProvider(p.id)} />)}
      </View>

      <Label>PERMISSIONS</Label>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {MODES.map((m) => <Chip key={m.id} label={m.label} icon={m.icon} on={mode === m.id} onPress={() => setMode(m.id)} />)}
      </View>
      <Text style={{ color: c.dim, fontSize: 13 }}>
        {mode === 'ask' ? 'Runs are unattended, so in Ask mode every edit and command it would ask about is declined: fine for reports, not for fixes.' : MODES.find((m) => m.id === mode)?.desc}
        {' '}Questions get “decide yourself”, and Claude can’t run sudo, force-push, reset --hard and the like. The report lists what was skipped.
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderCurve: 'continuous', backgroundColor: c.card }}>
        <Icon name="arrow.triangle.branch" color={c.accent} />
        <Text style={{ color: c.text, flex: 1 }}>Each run in its own worktree</Text>
        <Switch value={worktree} onValueChange={setWorktree} />
      </View>

      <Button kind="accent" label={busy ? 'Saving…' : 'Save'} disabled={busy || !prompt.trim() || !cwd || !agent || !timeOk || !cron} onPress={save} />
    </ScrollView>
  );
}
