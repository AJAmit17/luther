import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { api, del, post } from '@/lib/hosts';
import { BlockRow } from '@/components/chat-rows';
import { Composer } from '@/components/composer';
import { PromptCard } from '@/components/prompt-card';
import { useAttachments } from '@/components/attachments';
import { useModels } from '@/components/model-picker';
import { knobs } from '@/components/thinking';
import { TaskPanel } from '@/components/task-panel';
import { GoalPanel } from '@/components/goal-panel';
import { blockBuilder, type Block } from '@/lib/blocks';
import type { Command, Prompt, Provider, Turn } from '@/lib/protocol';
import { openThread } from '@/lib/threads';
import { setWatching } from '@/lib/feed';
import { useThread } from '@/lib/socket';
import { useVoice } from '@/lib/voice';
import { Banner, EmptyState, HeaderActions, Icon, Press, Span, StatusDot, Surface, Text, WorkingRing, alert, radius, shadow, space, type, useTheme } from '@/design';
import { AgentMark, agentName } from '@/features/agents';

function useKeyboardShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const subs = [Keyboard.addListener('keyboardWillShow', () => setShown(true)), Keyboard.addListener('keyboardWillHide', () => setShown(false))];
    return () => subs.forEach((s) => s.remove());
  }, []);
  return shown;
}

/** Floats above the composer: the agent at work and for how long, and a way back to the newest message. */
function WorkingPill({ busy, since, away, jump, provider }: { busy: boolean; since?: number; away: boolean; jump: () => void; provider?: Provider }) {
  const { color } = useTheme();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busy]);
  if (!busy && !away) return null;
  const s = since ? Math.max(0, Math.floor((now - since) / 1000)) : undefined;
  const elapsed = s === undefined ? '' : s < 3600 ? ` · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : ` · ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', bottom: space.sm, left: 0, right: 0, alignItems: 'center' }}>
      <Press onPress={away ? jump : undefined} disabled={!away && !busy} accessibilityRole={away ? 'button' : undefined}>
        <Surface style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, paddingHorizontal: space.md + 2, paddingVertical: space.sm, borderRadius: radius.full, boxShadow: shadow.raised }}>
          {busy &&
            (provider ? (
              <WorkingRing size={14} active>
                <AgentMark p={provider} size={14} />
              </WorkingRing>
            ) : (
              <StatusDot color={color.accent} live size={7} />
            ))}
          {busy && <Text variant="footnote" weight="medium" color="text" style={{ fontVariant: ['tabular-nums'] }}>Working{elapsed}</Text>}
          {away && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <Icon name="arrow.down" size={12} color={color.accent} />
              <Text variant="footnote" weight="medium" color="accent">Latest</Text>
            </View>
          )}
        </Surface>
      </Press>
    </View>
  );
}

// One conversation with an agent on the Mac. Every phone attached to it (and
// anything else attached to the same thread) sees the same stream.
export default function ThreadScreen() {
  const { id, cwd, send } = useLocalSearchParams<{ id: string; cwd?: string; send?: string }>();
  const ev = useThread(id);
  const att = useAttachments({ id, cwd });
  const headerHeight = useHeaderHeight();
  const { color } = useTheme();
  const inset = useSafeAreaInsets().bottom;
  const keyboard = useKeyboardShown();
  const list = useRef<FlatList<Block>>(null);
  const [away, setAway] = useState(false);
  const [text, setText] = useState('');
  const [cmds, setCmds] = useState<Command[]>([]);
  const [qa, setQa] = useState<{ id?: string; answers: Record<string, string[]> }>({ answers: {} }); // question in progress
  const st = ev.state;
  const provider = st?.provider;
  const models = useModels(provider);
  const dir = (st?.cwd || cwd || '').split('/').pop() || 'Thread';
  const top = ev.prompts[0];
  const answers = top && qa.id === top.id ? qa.answers : {};
  const busy = !!st?.busy;

  useFocusEffect(
    useCallback(() => {
      setWatching(id);
      return () => setWatching(null);
    }, [id]),
  );

  useEffect(() => {
    if (!provider) return;
    api<Command[]>(`/commands?provider=${provider}&cwd=${encodeURIComponent(st?.cwd ?? '')}`).then(setCmds, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  useEffect(() => {
    if (top) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [top?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A message handed over by Shortcuts / the Share Sheet / a widget: sent once connected.
  const handed = useRef(false);
  useEffect(() => {
    if (send && !handed.current && ev.status === 'open' && st) {
      handed.current = true;
      ev.sendText(send); // mid-turn, the agent queues or steers it
      router.setParams({ send: undefined });
    }
  }, [send, ev.status, st]); // eslint-disable-line react-hooks/exhaustive-deps

  const voice = useVoice((said) => {
    if (ev.sendText(said, att.paths)) att.clear();
    else setText(said);
  });

  // Engine commands (from Claude's init) cover plugins and skills /commands doesn't know.
  const allCmds = useMemo(() => {
    const seen = new Set(cmds.map((x) => x.name));
    const extra = (st?.commands ?? []).map((n) => (n.startsWith('/') ? n : '/' + n)).filter((n) => !seen.has(n));
    return [...cmds, ...extra.map((name) => ({ name, desc: '' }))];
  }, [cmds, st?.commands]);
  // @-mentions: the word being typed after "@" searches the project's files.
  const mention = /(?:^|\s)@([^\s@]*)$/.exec(text)?.[1];
  const [found, setFound] = useState<string[]>([]);
  useEffect(() => {
    if (mention === undefined || !st?.cwd) return; // suggestions show only while a mention is typed
    const t = setTimeout(() => api<string[]>(`/files/search?cwd=${encodeURIComponent(st.cwd)}&q=${encodeURIComponent(mention)}`).then(setFound, () => setFound([])), 150);
    return () => clearTimeout(t);
  }, [mention, st?.cwd]);
  const suggest: { key: string; label: string; desc: string; pick: () => void }[] =
    mention !== undefined
      ? found.slice(0, 6).map((f) => ({ key: f, label: '@' + f, desc: '', pick: () => setText(text.slice(0, text.length - mention.length - 1) + '@' + f + ' ') }))
      : text.startsWith('/') && !text.includes(' ')
        ? allCmds.filter((x) => x.name.startsWith(text)).slice(0, 5).map((x) => ({ key: x.name, label: x.name, desc: x.desc, pick: () => setText(x.name + ' ') }))
        : [];

  // Unchanged blocks keep their identity, so only the streaming row re-renders per token.
  const [build] = useState(blockBuilder);
  const blocks = useMemo(() => [...build(ev.messages)].reverse(), [build, ev.messages]);

  const answerQuestion = (p: Prompt, labels: string[]) => {
    const qs = p.questions ?? [];
    const next = { ...answers, [qs[Object.keys(answers).length].id]: labels };
    if (Object.keys(next).length >= qs.length) ev.answer({ id: p.id, answers: next });
    else setQa({ id: p.id, answers: next });
  };

  const canSend = top ? !!text.trim() : (!!text.trim() || att.items.length > 0) && !att.uploading;
  const submit = () => {
    const t = text.trim();
    if (!canSend) return;
    if (top?.kind === 'question') answerQuestion(top, [t]);
    else if (top) {
      if (!ev.answer({ id: top.id, message: t })) return; // "No, do this instead"
    } else if (t.startsWith('!') && t.length > 1 && !att.items.length) {
      shell(t.slice(1).trim());
    } else if (!ev.sendText(t, att.paths)) return;
    else att.clear();
    setText('');
  };

  // "!command": runs on the Mac in the project; the output can go to the agent.
  const shell = (command: string) => {
    if (!st?.cwd) return;
    post<{ output: string; code: number }>('/shell', { cwd: st.cwd, command }).then(
      (r) => {
        const out = r.output.trim() || '(no output)';
        alert(`$ ${command}`, `${out.length > 1500 ? '…' + out.slice(-1500) : out}\n\nexit ${r.code}`, [
          { text: 'Close', style: 'cancel' },
          { text: 'Send to agent', onPress: () => ev.sendText(`I ran \`${command}\` (exit ${r.code}):\n\n\`\`\`\n${out.length > 12000 ? '…' + out.slice(-12000) : out}\n\`\`\``) },
        ]);
      },
      (e) => alert(`$ ${command}`, e.message),
    );
  };

  // Edit the last message: it comes back into the composer; the files its turn
  // changed can be undone too. The earlier exchange stays in the conversation.
  const editLast = () => {
    const last = [...ev.messages].reverse().find((m) => m.role === 'user' && !m.parent);
    if (!last?.text) return alert('Nothing to edit', 'There’s no message of yours in this conversation yet.');
    api<Turn[]>(`/threads/${encodeURIComponent(id)}/turns`).then(
      (turns) => {
        const t = turns[0];
        const back = () => setText(last.text);
        if (!t?.endedAt || !t.files) return back();
        alert('Undo what it changed too?', `That turn changed ${t.files === 1 ? '1 file' : `${t.files} files`}. Put them back as they were before it, then edit your message?`, [
          { text: 'Just edit', onPress: back },
          { text: 'Undo and edit', style: 'destructive', onPress: () => post(`/threads/${encodeURIComponent(id)}/turns/${t.n}/revert`, {}).then(back, (e) => alert('Undo failed', e.message)) },
          { text: 'Cancel', style: 'cancel' },
        ]);
      },
      () => setText(last.text),
    );
  };
  const fork = () => st && provider && openThread({ provider, cwd: st.cwd, resume: st.session, fork: true });
  const compact = () =>
    alert('Compact the conversation?', 'The agent summarizes it so far, freeing context for what comes next.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Compact', onPress: () => ev.compact() },
    ]);

  const terminal = () =>
    st?.cwd &&
    post<{ name: string }>('/terms', { cwd: st.cwd }).then(
      (r) => router.push({ pathname: '/term/[name]', params: { name: r.name, cwd: st.cwd } }),
      (e) => alert('Could not open a terminal', e.message),
    );
  const stop = () =>
    alert(`Stop ${provider ? agentName(provider) : 'the agent'}?`, 'The conversation is saved; resume it from its project.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: () => del('/threads/' + encodeURIComponent(id)).then(() => router.back(), (e) => alert('Error', e.message)) },
    ]);
  const go = (pathname: '/files' | '/git' | '/preview' | '/instructions') => st?.cwd && router.push({ pathname, params: { cwd: st.cwd } });

  const mode = st?.mode ?? 'ask';
  const model = st?.model ?? '';
  const usage = st?.usage;
  const conn = ev.status === 'connecting' ? 'Connecting…' : ev.status === 'closed' ? 'Reconnecting…' : '';

  return (
    <>
      <Stack.Screen options={{ title: dir }} />
      <HeaderActions
        actions={[
          { icon: 'terminal', label: 'Open Terminal', onPress: terminal },
          {
            icon: 'ellipsis',
            label: 'More',
            menu: [
              { title: 'Files', icon: 'folder', onPress: () => go('/files') },
              { title: 'Changes', icon: 'arrow.triangle.branch', onPress: () => go('/git') },
              { title: 'Turns and Undo', icon: 'clock.arrow.circlepath', onPress: () => router.push({ pathname: '/turns', params: { id } }) },
              { title: 'Work Toward a Goal', icon: 'target', onPress: () => router.push({ pathname: '/goal', params: { id } }) },
              { title: 'Edit Last Message', icon: 'pencil', disabled: busy, onPress: editLast },
              { title: 'Fork Conversation', icon: 'arrow.triangle.branch', onPress: fork },
              ...(provider === 'claude' || provider === 'codex'
                ? [{ title: 'Compact Conversation', icon: 'arrow.down.right.and.arrow.up.left', disabled: busy, onPress: compact } as const]
                : []),
              { title: 'Preview Dev Server', icon: 'globe', onPress: () => go('/preview') },
              { title: 'Instructions', icon: 'text.book.closed', onPress: () => go('/instructions') },
              { title: 'Stop Agent', icon: 'stop.circle', destructive: true, onPress: stop },
            ],
          },
        ]}
      />

      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={{ flex: 1, backgroundColor: color.surface }}>
        {ev.status === 'ended' && <Banner icon="stop.circle" text="The agent stopped. Reopen the conversation from its project to resume." />}
        {!!conn && <Banner icon="arrow.triangle.2.circlepath" text={conn} />}
        {!!st?.dup && <Banner tone="danger" icon="exclamationmark.triangle" text="Also open in a terminal on the Mac. Both are writing to it." />}
        {!!ev.error && <Banner tone="danger" text={ev.error} onPress={() => ev.setError('')} />}

        <View style={{ flex: 1 }}>
          <FlatList
            ref={list}
            inverted
            data={blocks}
            keyExtractor={(b) => b.id}
            renderItem={({ item, index }) => {
              const live = busy && index === 0 && item.kind !== 'msg';
              return <BlockRow b={item} live={live} activity={live ? st?.activity : undefined} />;
            }}
            ItemSeparatorComponent={Gap}
            ListHeaderComponent={
              // Inverted: the header is the bottom edge, under the newest block.
              <View style={{ gap: space.lg, paddingTop: blocks.length ? space.lg : 0 }}>
                {!!ev.draft && <BlockRow b={{ kind: 'msg', id: '__draft', m: { id: '__draft', role: 'assistant', text: ev.draft + ' ▍' } }} live={false} />}
              </View>
            }
            onScroll={(e) => setAway(e.nativeEvent.contentOffset.y > 240)}
            scrollEventThrottle={100}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: busy || away ? 56 : space.md, paddingBottom: space.lg, flexGrow: 1 }}
          />
          {!blocks.length && !ev.draft && (
            // Over the list, not its empty view: an inverted list draws that upside down (differently per platform).
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
              {ev.status === 'open' ? (
                <EmptyState icon="bubble.left.and.text.bubble.right" title={`Ask ${provider ? agentName(provider) : 'the agent'}`} message={`Anything about ${dir}. It runs on your Mac, with your files.`} />
              ) : (
                <EmptyState icon="antenna.radiowaves.left.and.right" title="Connecting" message="Reaching your Mac…" />
              )}
            </View>
          )}
          <WorkingPill busy={busy} since={ev.since} away={away} jump={() => list.current?.scrollToOffset({ offset: 0, animated: true })} provider={provider} />
        </View>

        <View style={{ paddingHorizontal: space.md, paddingTop: space.xs + 2, paddingBottom: keyboard ? space.xs + 2 : Math.max(inset, space.sm), gap: space.sm }}>
          {suggest.length > 0 && (
            <Surface style={{ overflow: 'hidden' }}>
              {suggest.map((x, i) => (
                <Press key={x.key} onPress={x.pick} scale={1} accessibilityRole="button" style={{ paddingHorizontal: space.md + 2, paddingVertical: space.sm + 2, borderTopWidth: i ? 1 : 0, borderTopColor: color.line }}>
                  <Text variant="subhead" mono numberOfLines={1} ellipsizeMode="head">
                    {x.label} {!!x.desc && <Span color="dim" style={{ fontSize: type.caption.fontSize }}>{x.desc}</Span>}
                  </Text>
                </Press>
              ))}
            </Surface>
          )}
          {!top && !!st?.goal && <GoalPanel thread={id} goal={st.goal} />}
          {!top && !!st?.tasks?.length && <TaskPanel tasks={st.tasks} />}
          {top && (
            <PromptCard
              key={`${top.id}:${Object.keys(answers).length}`}
              p={top}
              more={ev.prompts.length - 1}
              answered={Object.keys(answers).length}
              onChoose={(choice) => ev.answer({ id: top.id, choice })}
              onAnswer={(labels) => answerQuestion(top, labels)}
              onSkip={() => ev.answer({ id: top.id })}
            />
          )}
          <Composer
            text={text}
            setText={setText}
            placeholder={top?.kind === 'question' ? 'Or type your own answer' : top ? 'Or tell it what to do instead' : busy ? (provider === 'codex' ? 'Steer the running turn…' : 'Queue a message…') : allCmds.length ? 'Message, / commands, @ files, ! shell' : 'Message, @ files, ! shell'}
            att={att}
            attach={!top}
            provider={provider}
            model={model}
            models={models}
            setModel={ev.setModel}
            mode={mode}
            setMode={ev.setMode}
            think={{ ...knobs(st, models), setEffort: ev.setEffort, setFast: ev.setFast }}
            canSend={canSend}
            send={submit}
            canStop={busy && !top}
            stop={ev.interrupt}
            voice={voice}
            usage={usage}
          />
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const Gap = () => <View style={{ height: space.lg }} />;
