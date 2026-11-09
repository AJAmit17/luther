import { useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { MenuView } from '@expo/ui/community/menu';
import { api } from '@/lib/hosts';
import type { Mode, Provider, ProviderInfo, Repository, Template } from '@/lib/protocol';
import { openThread } from '@/lib/threads';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ModelPicker, modelName, useModels } from '@/components/model-picker';
import { Button, Group, GroupRow, Icon, MODES, Note, ProviderIcon, c, card, home, tint, type, useLoad, useScheme } from '@/components/ui';

// New thread in a folder (a sheet): the agent, its model, permissions, worktree.
export default function NewThread() {
  const scheme = useScheme();
  const insets = useSafeAreaInsets();
  const { cwd } = useLocalSearchParams<{ cwd: string }>();
  const { data: providers, error } = useLoad(() => api<ProviderInfo[]>('/providers'), [], 'providers');
  const installed = (providers ?? []).filter((p) => p.installed);
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
  const { data: repos, error: repoError, loading: loadingRepos } = useLoad(
    () => worktree ? api<Repository[]>('/git/repos?cwd=' + encodeURIComponent(cwd)) : Promise.resolve<Repository[]>([]),
    [worktree, cwd],
  );
  const [busy, setBusy] = useState(false);
  const p = provider ?? installed[0]?.id ?? null;
  const worktreeCwd = repos?.find((r) => r.cwd === repo && !r.error)?.cwd ?? (repos?.length === 1 && !repos[0].error ? repos[0].cwd : '');

  const models = useModels(p);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.surface }} contentContainerStyle={{ padding: 20, paddingTop: 28, gap: 20, paddingBottom: 40 + Math.max(insets.bottom, process.env.EXPO_OS === 'android' ? 48 : 0) }}>
      <View style={{ gap: 4 }}>
        <Text style={type.title2}>New thread</Text>
        <Text selectable style={type.footnote} numberOfLines={1}>{home(cwd)}</Text>
      </View>
      {!!error && <Note error>{error}</Note>}
      {providers && !installed.length && <Note error>No agent CLI is installed on this Mac (claude, codex, opencode, gemini, cursor, devin).</Note>}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {installed.map((x) => {
          const on = p === x.id;
          return (
            <Pressable
              key={x.id}
              onPress={() => {
                setProvider(x.id);
                setModel('');
              }}
              style={({ pressed }) => [card, { width: '47%', flexGrow: 1, padding: 12, gap: 8, borderColor: on ? c.accent : c.line, borderWidth: on ? 1.5 : 1, backgroundColor: on ? tint('accent', 0.08) : c.card, opacity: pressed ? 0.8 : 1 }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <ProviderIcon p={x.id} size={30} />
                {on && <Icon name="checkmark.circle.fill" size={18} color={c.accent} />}
              </View>
              <View>
                <Text style={type.headline}>{x.name}</Text>
                <Text style={type.caption} numberOfLines={1}>{x.version || 'installed'}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {!!roles?.length && (
        <Group title="Role" footer={roleInfo ? roleInfo.description : 'Roles are Markdown files in ~/.luther/templates on your Mac.'}>
          <MenuView
            colorScheme={scheme}
            actions={[{ id: '', title: 'None', state: role ? 'off' : 'on' }, ...roles.map((r) => ({ id: r.name, title: r.name, subtitle: r.description, state: (r.name === role ? 'on' : 'off') as 'on' | 'off' }))]}
            onPressAction={({ nativeEvent }) => pickRole(nativeEvent.event)}
          >
            <GroupRow first icon="theatermasks" label={role || 'None'} sub={roleInfo ? 'Its instructions go before your first message' : undefined} right={<Icon name="chevron.up.chevron.down" size={13} color={c.faint} />} />
          </MenuView>
        </Group>
      )}

      <Group title="Model">
        <GroupRow
          first
          icon="cpu"
          label={modelName(models, model) || 'Default'}
          sub={model ? models.find((m) => m.id === model)?.desc : models.length ? `${models.length} models` : 'Asking the agent for its models…'}
          onPress={() => setPicking(true)}
          right={<Icon name="chevron.up.chevron.down" size={13} color={c.faint} />}
        />
        <ModelPicker open={picking} models={models} selected={model} onPick={setModel} onClose={() => setPicking(false)} withDefault />
      </Group>

      <Group title="Permissions">
        {MODES.map((m, i) => (
          <GroupRow
            key={m.id}
            first={i === 0}
            icon={m.icon}
            iconColor={m.id === 'full' ? c.red : c.accent}
            label={m.label}
            sub={p === 'devin' && m.id === 'ask' ? 'Devin’s native Ask mode is read-only' : m.desc}
            right={mode === m.id ? <Icon name="checkmark" size={15} color={c.accent} /> : <View style={{ width: 15 }} />}
            onPress={() => setMode(m.id)}
          />
        ))}
      </Group>

      <Group footer="Its own branch and checkout, so several agents in one project don't step on each other.">
        <GroupRow first icon="arrow.triangle.branch" iconColor={c.blue} label="Separate worktree" right={<Switch value={worktree} onValueChange={setWorktree} />} />
        {worktree ? (
          <MenuView colorScheme={scheme} actions={(repos ?? []).filter((r) => !r.error).map((r) => ({ id: r.cwd, title: r.name, subtitle: r.branch, state: r.cwd === worktreeCwd ? 'on' : 'off' }))} onPressAction={({ nativeEvent }) => setRepo(nativeEvent.event)}>
            <GroupRow icon="folder" label={loadingRepos ? 'Finding repositories…' : repos?.find((r) => r.cwd === worktreeCwd)?.name || 'Choose a repository'} sub={repoError || (!loadingRepos && !repos?.length ? 'No git checkouts found in this folder' : 'The thread will run in a worktree of this repository')} />
          </MenuView>
        ) : null}
      </Group>

      <Button
        kind="accent"
        icon="play.fill"
        label={busy ? 'Starting…' : 'Start'}
        busy={busy}
        disabled={!p || (worktree && (loadingRepos || !worktreeCwd || !!repoError))}
        onPress={() => {
          setBusy(true);
          const dir = worktree && !cwd.startsWith(worktreeCwd + '/') ? worktreeCwd : cwd;
          openThread({ provider: p!, cwd: dir, mode, model: model || undefined, worktree: worktree || undefined, template: role || undefined }, true).finally(() => setBusy(false));
        }}
      />
    </ScrollView>
  );
}
