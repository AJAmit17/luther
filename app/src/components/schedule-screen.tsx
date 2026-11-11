import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Chip, Field, Group, HeaderActions, Icon, ListItem, SectionHeader, Segmented, Text, TextInput, Toggle, alert, space, useTheme, MenuRow } from '@/design';
import { AgentMark, MODES, agentName, modeOf } from '@/features/agents';
import { ModelPicker, modelName, useModels } from '@/components/model-picker';
import { api, post } from '@/lib/hosts';
import { home, until } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import type { Job, Mode, Project, Provider, ProviderInfo } from '@/lib/protocol';
import { DAYS, describe, fromCron, parseTime, toCron, type Preset } from '@/lib/cron';
import { peek } from '@/lib/cache';

// Prompts that make good unattended runs.
const STARTERS = [
  { name: 'Health report', prompt: 'Give me a short health report of this repository: failing or flaky tests, build warnings, recent TODOs, and anything that looks broken. Don’t change any files.' },
  { name: 'Fix failing tests', prompt: 'Run the test suite. If anything fails, find the cause and fix it, then run the suite again. Report what failed and what you changed.' },
  { name: 'Dependency check', prompt: 'List outdated or vulnerable dependencies using the package manager’s own audit and outdated commands, and what each upgrade would involve. Don’t upgrade anything.' },
  { name: 'Docs drift', prompt: 'Compare the README and docs with the code. List what is out of date or missing, and fix the docs where you are sure.' },
  { name: 'Security review', prompt: 'Review the code changed in the last day (git log --since=1.day) for security problems: injection, secrets in code, unsafe input handling. Report each with file and line. Don’t change any files.' },
];

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'hourly', label: 'Hourly' },
  { id: 'custom', label: 'Custom' },
];

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The next few days a preset runs on, by the phone's clock (close enough to the Mac's for a hint). */
function nextDays(preset: Preset, time: string, day: number): string {
  const t = parseTime(time);
  if (!t || preset === 'hourly' || preset === 'custom') return '';
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; out.length < (preset === 'weekly' ? 1 : 3) && i < 15; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, t[0], t[1]);
    const wd = d.getDay();
    if (d <= now || (preset === 'weekdays' && (wd === 0 || wd === 6)) || (preset === 'weekly' && wd !== day)) continue;
    out.push(i === 0 ? 'today' : i === 1 ? 'tomorrow' : SHORT[wd]);
  }
  return out.join(', ');
}

// One schedule: what to run, where, with which agent, and when.
export default function ScheduleEditor() {
  const { color } = useTheme();
  const params = useLocalSearchParams<{ id?: string; cwd?: string; prompt?: string; provider?: Provider }>();
  const existing = params.id ? peek<Job[]>('schedules:[]')?.find((j) => j.id === params.id) : undefined;
  const start = fromCron(existing?.cron ?? '0 9 * * 1-5');
  const [name, setName] = useState(existing?.name ?? '');
  const [prompt, setPrompt] = useState(existing?.prompt ?? params.prompt ?? '');
  const [cwd, setCwd] = useState(existing?.cwd ?? params.cwd ?? '');
  const [provider, setProvider] = useState<Provider | null>(existing?.provider ?? params.provider ?? null);
  const [model, setModel] = useState(existing?.model ?? '');
  const [picking, setPicking] = useState(false);
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
  const models = useModels(agent);
  const cron = preset === 'custom' ? custom.trim() : toCron(preset, time, day);
  const timeOk = preset === 'custom' || preset === 'hourly' || !!parseTime(time);
  const next = existing?.next && existing.cron === cron ? until(existing.next) : nextDays(preset, time, day);
  const ready = !busy && !!prompt.trim() && !!cwd && !!agent && timeOk && !!cron;

  const save = () => {
    setBusy(true);
    const job: Partial<Job> = { ...existing, name, prompt, cwd, provider: agent!, model: model || undefined, mode, worktree, cron, enabled: existing?.enabled ?? true };
    post('/schedules', job).then(() => router.back(), (e) => alert('Could not save', e.message)).finally(() => setBusy(false));
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl + space.sm }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: existing ? 'Edit Schedule' : 'New Schedule' }} />
      <HeaderActions actions={[{ text: busy ? 'Saving…' : 'Save', disabled: !ready, onPress: save, prominent: true }]} />

      <Field lines={4} value={prompt} onChangeText={setPrompt} placeholder="e.g. Run the test suite and fix anything that fails" />
      {!existing && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} style={{ marginTop: -space.sm }}>
          {STARTERS.map((x) => (
            <Chip
              key={x.name}
              label={x.name}
              selected={prompt === x.prompt}
              onPress={() => {
                setPrompt(x.prompt);
                if (!name) setName(x.name);
              }}
            />
          ))}
        </ScrollView>
      )}
      <Field value={name} onChangeText={setName} placeholder="Name (optional)" />

      <View style={{ gap: space.sm }}>
        <SectionHeader title="When" />
        <Segmented options={PRESETS} value={preset} onChange={setPreset} />
        {preset === 'weekly' && (
          <View style={{ flexDirection: 'row', gap: space.xs + 2, flexWrap: 'wrap' }}>
            {DAYS.map((d, i) => <Chip key={d} label={d.slice(0, 3)} selected={day === i} onPress={() => setDay(i)} />)}
          </View>
        )}
        {preset === 'custom' ? (
          <Field mono value={custom} onChangeText={setCustom} placeholder="minute hour day month weekday" autoCapitalize="none" autoCorrect={false} />
        ) : preset !== 'hourly' ? (
          <Group>
            <ListItem
              icon="calendar.badge.clock"
              title="Time"
              trailing={<TextInput mono accessibilityLabel="Time" value={time} onChangeText={setTime} placeholder="09:00" keyboardType="numbers-and-punctuation" style={{ minWidth: 64, textAlign: 'right' }} />}
            />
          </Group>
        ) : null}
        <Text variant="footnote" color={timeOk ? 'dim' : 'red'} style={{ paddingHorizontal: space.lg }}>
          {timeOk ? `${describe(cron)}, Mac time, while it’s awake.${next ? ` Next: ${next}.` : ''}` : 'Time as HH:MM, 24-hour.'}
        </Text>
      </View>

      <Group
        title="Where"
        footer={mode === 'ask' ? 'Runs are unattended, so in Ask mode every edit and command it would ask about is declined: fine for reports, not for fixes.' : undefined}
      >
        <MenuRow
          first
          icon="folder"
          title={projects?.find((p) => p.cwd === cwd)?.name ?? (cwd ? cwd.split('/').pop()! : projects ? 'Choose a Project' : 'Loading projects…')}
          value={cwd ? home(cwd) : undefined}
          actions={(projects ?? []).map((p) => ({ id: p.cwd, title: p.name, subtitle: home(p.cwd), state: p.cwd === cwd ? ('on' as const) : ('off' as const) }))}
          onPick={setCwd}
        />
        <MenuRow
          leading={agent ? <AgentMark p={agent} size={18} /> : undefined}
          title={agent ? agentName(agent) : 'Choose an Agent'}
          actions={installed.map((p) => ({ id: p.id, title: p.name, state: p.id === agent ? ('on' as const) : ('off' as const) }))}
          onPick={(id) => {
            setProvider(installed.find((p) => p.id === id)?.id ?? null);
            setModel('');
          }}
        />
        <ListItem
          icon="cpu"
          title={modelName(models, model) || 'Default Model'}
          trailing={<Icon name="chevron.up.chevron.down" size={13} color={color.faint} />}
          onPress={() => setPicking(true)}
        />
        <MenuRow
          icon={modeOf(mode).icon}
          iconColor={mode === 'full' ? color.red : undefined}
          title={modeOf(mode).label}
          subtitle={modeOf(mode).desc}
          actions={MODES.map((m) => ({ id: m.id, title: m.label, subtitle: m.desc, state: m.id === mode ? ('on' as const) : ('off' as const) }))}
          onPick={(id) => setMode(MODES.find((m) => m.id === id)?.id ?? mode)}
        />
      </Group>
      <ModelPicker open={picking} models={models} selected={model} onPick={setModel} onClose={() => setPicking(false)} withDefault />

      <Group footer="Runs are unattended: questions are answered “decide yourself”, and Claude can’t run sudo, force-push, reset --hard and the like. The report lists what was skipped.">
        <ListItem icon="arrow.triangle.branch" title="Each Run in Its Own Worktree" trailing={<Toggle label="Each Run in Its Own Worktree" value={worktree} onValueChange={setWorktree} />} />
      </Group>
    </ScrollView>
  );
}
