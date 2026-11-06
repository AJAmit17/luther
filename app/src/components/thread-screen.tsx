import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Keyboard, Pressable, Text, View } from 'react-native';
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
import { TaskPanel } from '@/components/task-panel';
import { toBlocks, type Block } from '@/lib/blocks';
import type { Command, Prompt } from '@/lib/protocol';
import { setWatching } from '@/lib/feed';
import { useThread } from '@/lib/socket';
import { useVoice } from '@/lib/voice';
import { formatTokens as fmt } from '@/lib/usage';
import { Banner, Empty, Icon, ProviderMark, PulsingDot, c, card, mono, providerName, type, useHex } from '@/components/ui';

function useKeyboardShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const subs = [Keyboard.addListener('keyboardWillShow', () => setShown(true)), Keyboard.addListener('keyboardWillHide', () => setShown(false))];
    return () => subs.forEach((s) => s.remove());
  }, []);
  return shown;
}

/** Floats above the composer: how long the agent has been at it, and a way back to the newest message. */
function WorkingPill({ busy, since, away, jump }: { busy: boolean; since?: number; away: boolean; jump: () => void }) {
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
    <View pointerEvents="box-none" style={{ position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center' }}>
      <Pressable
        onPress={away ? jump : undefined}
        style={[card, { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, boxShadow: '0 2px 10px rgba(0,0,0,0.18)' }]}
      >
        {busy && <PulsingDot size={7} />}
        {busy && <Text style={[type.footnote, { color: c.text, fontWeight: '600', fontVariant: ['tabular-nums'] }]}>Working{elapsed}</Text>}
        {away && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="arrow.down" size={12} color={c.accent} />
            <Text style={[type.footnote, { color: c.accent, fontWeight: '600' }]}>Latest</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

// One conversation with an agent on the Mac. Every phone attached to it (and
// anything else attached to the same thread) sees the same stream.
export default function ThreadScreen() {
  const { id, cwd, send } = useLocalSearchParams<{ id: string; cwd?: string; send?: string }>();
  const ev = useThread(id);
  const att = useAttachments();
  const headerHeight = useHeaderHeight();
  const hx = useHex();
  const inset = useSafeAreaInsets().bottom;
  const keyboard = useKeyboardShown();
  const list = useRef<FlatList<Block>>(null);
  const [away, setAway] = useState(false);
  const [text, setText] = useState('');
  const [cmds, setCmds] = useState<Command[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [qa, setQa] = useState<{ id?: string; answers: Record<string, string[]> }>({ answers: {} }); // question in progress
  const st = ev.state;
  const provider = st?.provider;
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
    api<string[]>('/models?provider=' + provider).then(setModels, () => {});
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
  const suggest = text.startsWith('/') && !text.includes(' ') ? allCmds.filter((x) => x.name.startsWith(text)).slice(0, 5) : [];

  const blocks = useMemo(() => toBlocks(ev.messages).reverse(), [ev.messages]);

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
    } else if (!ev.sendText(t, att.paths)) return;
    else att.clear();
    setText('');
  };

  const terminal = () =>
    st?.cwd &&
    post<{ name: string }>('/terms', { cwd: st.cwd }).then(
      (r) => router.push({ pathname: '/term/[name]', params: { name: r.name, cwd: st.cwd } }),
      (e) => Alert.alert('Could not open a terminal', e.message),
    );
  const stop = () =>
    Alert.alert(`Stop ${provider ? providerName(provider) : 'the agent'}?`, 'The conversation is saved; resume it from its project.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: () => del('/threads/' + encodeURIComponent(id)).then(() => router.back(), (e) => Alert.alert('Error', e.message)) },
    ]);
  const go = (pathname: '/files' | '/git' | '/preview' | '/instructions') => st?.cwd && router.push({ pathname, params: { cwd: st.cwd } });

  const mode = st?.mode ?? 'ask';
  const model = st?.model ?? '';
  const usage = st?.usage;
  const conn = ev.status === 'connecting' ? 'Connecting…' : ev.status === 'closed' ? 'Reconnecting…' : '';

  // Memoized: a new headerTitle each render would redraw the native header on every streamed token.
  const headerTitle = useCallback(
    () => (
      <View style={{ alignItems: 'center' }}>
        <Text style={[type.headline, { color: hx.text }]} numberOfLines={1}>{dir}</Text>
        {!!provider && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <ProviderMark p={provider} size={12} color={hx.dim} />
            <Text style={[type.caption2, { color: hx.dim }]} numberOfLines={1}>{providerName(provider)}</Text>
          </View>
        )}
      </View>
    ),
    [dir, provider, hx.text, hx.dim],
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: dir,
          headerTitle,
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="terminal" onPress={terminal} />
        <Stack.Toolbar.Menu icon="ellipsis">
          <Stack.Toolbar.MenuAction icon="folder" onPress={() => go('/files')}>Files</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="arrow.triangle.branch" onPress={() => go('/git')}>Changes</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="clock.arrow.circlepath" onPress={() => router.push({ pathname: '/turns', params: { id } })}>Turns and undo</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="globe" onPress={() => go('/preview')}>Preview dev server</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="text.book.closed" onPress={() => go('/instructions')}>Instructions</Stack.Toolbar.MenuAction>
          {usage ? (
            <Stack.Toolbar.MenuAction icon="chart.bar" disabled onPress={() => {}}>
              {`${fmt(usage.inputTokens)} in · ${fmt(usage.outputTokens)} out${usage.costUsd ? ` · $${usage.costUsd.toFixed(2)}` : ''}`}
            </Stack.Toolbar.MenuAction>
          ) : null}
          <Stack.Toolbar.MenuAction icon="stop.circle" destructive onPress={stop}>Stop agent</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={{ flex: 1, backgroundColor: c.surface }}>
        {ev.status === 'ended' && <Banner icon="stop.circle" text="The agent stopped. Reopen the conversation from its project to resume." />}
        {!!conn && <Banner icon="arrow.triangle.2.circlepath" text={conn} />}
        {!!st?.dup && <Banner error icon="exclamationmark.triangle" text="Also open in a terminal on the Mac. Both are writing to it." />}
        {!!ev.error && <Banner error text={ev.error} onPress={() => ev.setError('')} />}

        <View style={{ flex: 1 }}>
          <FlatList
            ref={list}
            inverted
            data={blocks}
            keyExtractor={(b) => b.id}
            renderItem={({ item, index }) => <BlockRow b={item} live={busy && index === 0 && item.kind !== 'msg'} activity={st?.activity} />}
            ItemSeparatorComponent={Gap}
            ListHeaderComponent={
              // Inverted: the header is the bottom edge, under the newest block.
              <View style={{ gap: 16, paddingTop: blocks.length ? 16 : 0 }}>
                {!!ev.draft && <BlockRow b={{ kind: 'msg', id: '__draft', m: { id: '__draft', role: 'assistant', text: ev.draft + ' ▍' } }} live={false} />}
              </View>
            }
            ListEmptyComponent={
              <View style={{ transform: [{ scaleY: -1 }] }}>
                {ev.status === 'open' ? (
                  <Empty icon="bubble.left.and.text.bubble.right" title={`Ask ${provider ? providerName(provider) : 'the agent'}`} sub={`Anything about ${dir}. It runs on your Mac, with your files.`} />
                ) : (
                  <Empty icon="antenna.radiowaves.left.and.right" title="Connecting" sub="Reaching your Mac…" />
                )}
              </View>
            }
            onScroll={(e) => setAway(e.nativeEvent.contentOffset.y > 240)}
            scrollEventThrottle={100}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: busy || away ? 56 : 12, paddingBottom: 16, flexGrow: 1 }}
          />
          <WorkingPill busy={busy} since={ev.since} away={away} jump={() => list.current?.scrollToOffset({ offset: 0, animated: true })} />
        </View>

        <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: keyboard ? 6 : Math.max(inset, 8), gap: 8 }}>
          {suggest.length > 0 && (
            <View style={[card, { overflow: 'hidden' }]}>
              {suggest.map((x, i) => (
                <Pressable key={x.name} onPress={() => setText(x.name + ' ')} style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, backgroundColor: pressed ? c.muted : 'transparent' })}>
                  <Text style={{ fontFamily: mono, fontSize: 14, color: c.text }} numberOfLines={1}>
                    {x.name} <Text style={[type.caption, { fontFamily: undefined }]}>{x.desc}</Text>
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
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
            placeholder={top?.kind === 'question' ? 'Or type your own answer' : top ? 'Or tell it what to do instead' : busy ? (provider === 'codex' ? 'Steer the running turn…' : 'Queue a message…') : allCmds.length ? 'Message, or / for commands' : 'Message'}
            att={att}
            attach={!top}
            provider={provider}
            model={model}
            models={models}
            setModel={ev.setModel}
            mode={mode}
            setMode={ev.setMode}
            canSend={canSend}
            send={submit}
            canStop={busy && !top}
            stop={ev.interrupt}
            voice={voice}
          />
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const Gap = () => <View style={{ height: 16 }} />;
