import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Button, Field, Group, Icon, IconButton, ListItem, Note, SectionHeader, Toggle, space, useTheme, MenuRow, SheetFooter, SheetHeader, type MenuChoice } from '@/design';
import { AgentPicker, ModePicker } from '@/features/agents';
import { ModelPicker, modelName, useModels } from '@/components/model-picker';
import { api } from '@/lib/hosts';
import { home } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import type { Mode, Project, Provider, ProviderInfo, Repository, Template } from '@/lib/protocol';
import { openThread } from '@/lib/threads';

// New task from a project (/new) or "Send to Luther" (/send). A luther://send link only
// prefills, never starts a thread, and its cwd and agent count only if the Mac lists them.
function NewTask({ send }: { send?: boolean }) {
  const { color } = useTheme();
  const params = useLocalSearchParams<{ cwd?: string; text?: string; provider?: Provider }>();
  const [text, setText] = useState(params.text ?? '');
  const [chosen, setCwd] = useState('');
  const { data: providers, error } = useLoad(() => api<ProviderInfo[]>('/providers'), [], 'providers');
  const { data: projects, error: projectsError } = useLoad(() => (send ? api<Project[]>('/projects') : Promise.resolve<Project[]>([])), [send], 'projects');
  const installed = (providers ?? []).filter((p) => p.installed);
  const linked = send ? projects?.find((x) => x.cwd === params.cwd)?.cwd : params.cwd;
  const cwd = chosen || linked || '';
  const [provider, setProvider] = useState<Provider | null>(null);
  const [picking, setPicking] = useState(false);
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<Mode>('ask');
  const [worktree, setWorktree] = useState(false);
  // A role (~/.luther/templates on the Mac): its instructions go before your first message.
  const { data: roles } = useLoad(() => api<Template[]>('/templates'), [], 'templates');
  const [role, setRole] = useState('');
  const pickRole = (name: string) => {
    setRole(name);
    const t = roles?.find((r) => r.name === name);
    if (!t) return;
    if (t.provider && installed.some((x) => x.id === t.provider)) setProvider(t.provider);
    if (t.mode) setMode(t.mode);
    setModel(t.model ?? '');
  };
  const roleInfo = roles?.find((r) => r.name === role);
  const [repo, setRepo] = useState('');
  const {
    data: repos,
    error: repoError,
    loading: loadingRepos,
  } = useLoad(() => (worktree && cwd ? api<Repository[]>('/git/repos?cwd=' + encodeURIComponent(cwd)) : Promise.resolve<Repository[]>([])), [worktree, cwd]);
  const [busy, setBusy] = useState(false);
  const p = provider ?? installed.find((x) => x.id === params.provider)?.id ?? installed[0]?.id ?? null;
  const worktreeCwd = repos?.find((r) => r.cwd === repo && !r.error)?.cwd ?? (repos?.length === 1 && !repos[0].error ? repos[0].cwd : '');
  const models = useModels(p);
  const project = projects?.find((x) => x.cwd === cwd);
  const go = () => {
    setBusy(true);
    const dir = worktree && !cwd.startsWith(worktreeCwd + '/') ? worktreeCwd : cwd;
    openThread({ provider: p!, cwd: dir, mode, model: model || undefined, worktree: worktree || undefined, template: role || undefined }, true, text.trim() || undefined).finally(() => setBusy(false));
  };
  return (
    <View style={{ flex: 1, backgroundColor: send ? color.bg : color.surface }}>
      {send && <Stack.Screen options={{ title: 'New Task' }} />}
      <ScrollView
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{ padding: space.lg + space.xs, paddingTop: send ? space.lg : space.xl + space.xs, gap: space.lg + space.xs }}
      >
        {!send && <SheetHeader title="New Task" />}
        {!!(error || projectsError) && <Note tone="danger">{error || projectsError}</Note>}
        {providers && !installed.length && <Note tone="danger">No agent CLI is installed on this Mac (claude, codex, opencode, gemini, cursor, devin).</Note>}
        <Field lines={4} value={text} onChangeText={setText} placeholder="What should the agent do?" autoFocus={send && !params.text} />
        <View style={{ gap: space.sm }}>
          <SectionHeader title="Agent" />
          <AgentPicker
            agents={installed.map((x) => x.id)}
            value={p ? [p] : []}
            onChange={([next]) => {
              setProvider(next);
              setModel('');
            }}
          />
        </View>
        <Group>
          {send ? (
            <MenuRow
              first
              icon="folder"
              title={project?.name ?? (cwd ? cwd.split('/').pop()! : 'Choose a Project')}
              value={cwd ? home(cwd) : undefined}
              actions={(projects ?? []).map((x): MenuChoice => ({ id: x.cwd, title: x.name, subtitle: home(x.cwd), state: x.cwd === cwd ? 'on' : 'off' }))}
              onPick={(next) => {
                setCwd(next);
                setRepo('');
              }}
            />
          ) : (
            <ListItem icon="folder" title={cwd.split('/').pop() || cwd} value={home(cwd)} />
          )}
          <ListItem
            icon="cpu"
            title={modelName(models, model) || 'Default Model'}
            subtitle={model ? models.find((m) => m.id === model)?.desc : models.length ? `${models.length} models` : 'Asking the agent for its models…'}
            trailing={<Icon name="chevron.up.chevron.down" size={13} color={color.faint} />}
            onPress={() => setPicking(true)}
          />
        </Group>
        <ModelPicker open={picking} models={models} selected={model} onPick={setModel} onClose={() => setPicking(false)} withDefault />
        {!!roles?.length && (
          <Group title="Role" footer={roleInfo ? roleInfo.description : 'Roles are Markdown files in ~/.luther/templates on your Mac.'}>
            <MenuRow
              first
              icon="theatermasks"
              title={role || 'None'}
              subtitle={roleInfo ? 'Its instructions go before your first message' : undefined}
              actions={[
                { id: '', title: 'None', state: role ? 'off' : 'on' },
                ...roles.map((r): MenuChoice => ({ id: r.name, title: r.name, subtitle: r.description, state: r.name === role ? 'on' : 'off' })),
              ]}
              onPick={pickRole}
            />
          </Group>
        )}
        <View style={{ gap: space.sm }}>
          <SectionHeader title="Permissions" />
          <ModePicker value={mode} onChange={setMode} provider={p ?? undefined} />
        </View>
        <Group footer="Its own branch and checkout, so several agents in one project don't step on each other.">
          <ListItem icon="arrow.triangle.branch" title="Separate Worktree" trailing={<Toggle label="Separate Worktree" value={worktree} onValueChange={setWorktree} />} />
          {worktree ? (
            <MenuRow
              icon="folder"
              title={loadingRepos ? 'Finding repositories…' : repos?.find((r) => r.cwd === worktreeCwd)?.name || 'Choose a Repository'}
              subtitle={repoError || (!loadingRepos && !repos?.length ? 'No git checkouts found in this folder' : 'The thread will run in a worktree of this repository')}
              actions={(repos ?? []).filter((r) => !r.error).map((r): MenuChoice => ({ id: r.cwd, title: r.name, subtitle: r.branch, state: r.cwd === worktreeCwd ? 'on' : 'off' }))}
              onPick={setRepo}
            />
          ) : null}
        </Group>
        {send && <Note>Tip: in Shortcuts, make one that opens luther://send?text=[Shortcut Input] and turn on “Show in Share Sheet”. Then share any text to Luther, or say its name to Siri.</Note>}
      </ScrollView>
      <SheetFooter>
        {!!cwd && (
          <IconButton
            icon="calendar.badge.clock"
            label="Schedule It Instead"
            variant="tinted"
            size={48}
            onPress={() => router.replace({ pathname: '/schedule', params: { cwd, prompt: text, ...(p ? { provider: p } : {}) } })}
          />
        )}
        <View style={{ flex: 1 }}>
          <Button variant="primary" label={busy ? 'Starting…' : 'Start Thread'} busy={busy} disabled={!p || !cwd || (worktree && (loadingRepos || !worktreeCwd || !!repoError))} onPress={go} />
        </View>
      </SheetFooter>
    </View>
  );
}
export default function NewThread() {
  return <NewTask />;
}
export function SendTask() {
  return <NewTask send />;
}
