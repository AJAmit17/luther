import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { api, del, post } from '@/lib/hosts';
import { Markdown } from '@/lib/markdown';
import type { Command, Msg, Prompt } from '@/lib/protocol';
import { useThread } from '@/lib/socket';
import { Banner, Icon, MODES, c, mono, providerName } from '@/lib/ui';

// One conversation with an agent on the Mac. Every phone attached to it (and
// anything else attached to the same thread) sees the same stream.
export default function ThreadScreen() {
  const { id, cwd } = useLocalSearchParams<{ id: string; cwd?: string }>();
  const ev = useThread(id);
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [cmds, setCmds] = useState<Command[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [qa, setQa] = useState<{ id?: string; answers: Record<string, string[]> }>({ answers: {} }); // question in progress
  const st = ev.state;
  const provider = st?.provider;
  const dir = (st?.cwd || cwd || '').split('/').pop() || 'Thread';
  const top = ev.prompts[0];
  const answers = top && qa.id === top.id ? qa.answers : {};

  useEffect(() => {
    if (!provider) return;
    api<Command[]>(`/commands?provider=${provider}&cwd=${encodeURIComponent(st?.cwd ?? '')}`).then(setCmds, () => {});
    api<string[]>('/models?provider=' + provider).then(setModels, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  useEffect(() => {
    if (top) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [top?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Engine commands (from Claude's init) cover plugins and skills /commands doesn't know.
  const allCmds = useMemo(() => {
    const seen = new Set(cmds.map((x) => x.name));
    const extra = (st?.commands ?? []).map((n) => (n.startsWith('/') ? n : '/' + n)).filter((n) => !seen.has(n));
    return [...cmds, ...extra.map((name) => ({ name, desc: '' }))];
  }, [cmds, st?.commands]);
  const suggest = text.startsWith('/') && !text.includes(' ') ? allCmds.filter((x) => x.name.startsWith(text)).slice(0, 6) : [];

  const data = useMemo(() => {
    const list: Msg[] = [...ev.messages].reverse();
    if (ev.draft) list.unshift({ id: '__draft', role: 'assistant', text: ev.draft + ' ▍' });
    return list;
  }, [ev.messages, ev.draft]);

  const answerQuestion = (p: Prompt, labels: string[]) => {
    const qs = p.questions ?? [];
    const next = { ...answers, [qs[Object.keys(answers).length].id]: labels };
    if (Object.keys(next).length >= qs.length) ev.answer({ id: p.id, answers: next });
    else setQa({ id: p.id, answers: next });
  };

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    if (top?.kind === 'question') answerQuestion(top, [t]);
    else if (top) { if (!ev.answer({ id: top.id, message: t })) return; } // "No, do this instead"
    else if (!ev.sendText(t)) return;
    setText('');
  };

  const terminal = () =>
    st?.cwd && post<{ name: string }>('/terms', { cwd: st.cwd }).then((r) => router.push({ pathname: '/term/[name]', params: { name: r.name, cwd: st.cwd } }), (e) => Alert.alert('Could not open a terminal', e.message));
  const stop = () =>
    Alert.alert(`Stop ${provider ? providerName(provider) : 'the agent'}?`, 'The conversation is saved; resume it from its project.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: () => del('/threads/' + encodeURIComponent(id)).then(() => router.back(), (e) => Alert.alert('Error', e.message)) },
    ]);

  const mode = st?.mode ?? 'ask';
  const model = st?.model ?? '';
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg as any }} behavior="padding" keyboardVerticalOffset={insets.top + 44}>
      <Stack.Screen options={{ title: provider ? `${providerName(provider)} · ${dir}` : dir }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="terminal" onPress={terminal} />
        <Stack.Toolbar.Menu icon="ellipsis.circle">
          <Stack.Toolbar.Menu inline title="Permissions">
            {MODES.map((m) => (
              <Stack.Toolbar.MenuAction key={m.id} icon={m.icon as any} isOn={mode === m.id} subtitle={m.desc} onPress={() => ev.setMode(m.id)}>{m.label}</Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.Menu title={model ? `Model · ${model}` : 'Model'} icon="cpu">
            {models.map((m) => (
              <Stack.Toolbar.MenuAction key={m} isOn={model === m || model.includes(m)} onPress={() => ev.setModel(m)}>{m}</Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.MenuAction icon="folder" onPress={() => st?.cwd && router.push({ pathname: '/files', params: { cwd: st.cwd } })}>Files</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="arrow.triangle.branch" onPress={() => st?.cwd && router.push({ pathname: '/git', params: { cwd: st.cwd } })}>Changes</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="stop.circle" destructive onPress={stop}>Stop agent</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      {ev.status === 'ended' && <Banner text="The agent stopped. Reopen the conversation from its project to resume." />}
      {(ev.status === 'connecting' || ev.status === 'closed') && <Banner text={ev.status === 'connecting' ? 'Connecting…' : 'Reconnecting…'} />}
      {!!st?.dup && <Banner error text="This conversation is also open in a terminal on the Mac. Both are writing to it." />}
      {!!ev.error && <Banner error text={ev.error} onPress={() => ev.setError('')} />}

      <FlatList
        inverted
        data={data}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <Bubble m={item} />}
        contentContainerStyle={{ padding: 14, gap: 4 }}
        keyboardDismissMode="interactive"
        ListEmptyComponent={
          <Text style={{ color: c.dim, textAlign: 'center', padding: 24, transform: [{ scaleY: -1 }] }}>
            {ev.status === 'open' ? `Ask ${provider ? providerName(provider) : 'the agent'} anything about ${dir}.` : 'Connecting…'}
          </Text>
        }
      />

      {top ? (
        <PromptCard
          key={`${top.id}:${Object.keys(answers).length}`}
          p={top}
          more={ev.prompts.length - 1}
          answered={Object.keys(answers).length}
          onChoose={(choice) => ev.answer({ id: top.id, choice })}
          onAnswer={(labels) => answerQuestion(top, labels)}
          onSkip={() => ev.answer({ id: top.id })}
        />
      ) : st?.busy ? (
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', borderTopWidth: 0.5, borderColor: c.line as any }}>
          <ActivityIndicator size="small" />
          <Text style={{ flex: 1, color: c.dim, fontFamily: mono, fontSize: 12 }} numberOfLines={1}>{st.activity || 'Working…'}</Text>
          <Pressable onPress={ev.interrupt} hitSlop={10} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.6 : 1 })}>
            <Icon name="stop.circle.fill" color={c.red} />
            <Text style={{ color: c.red, fontWeight: '600' }}>Stop</Text>
          </Pressable>
        </View>
      ) : st?.usage ? (
        <Text style={{ color: c.faint, fontSize: 11, textAlign: 'center', paddingVertical: 4 }}>
          {fmtTokens(st.usage.inputTokens)} in · {fmtTokens(st.usage.outputTokens)} out{st.usage.costUsd ? ` · $${st.usage.costUsd.toFixed(2)}` : ''}
        </Text>
      ) : null}

      {suggest.map((x) => (
        <Pressable key={x.name} onPress={() => setText(x.name + ' ')} style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: 9, backgroundColor: pressed ? c.fill : c.card })}>
          <Text style={{ color: c.text, fontFamily: mono }} numberOfLines={1}>
            {x.name} <Text style={{ color: c.dim, fontFamily: undefined, fontSize: 12 }}>{x.desc}</Text>
          </Text>
        </Pressable>
      ))}

      {mode !== 'ask' && !top && (
        <Text style={{ color: mode === 'full' ? c.red : c.accent, fontSize: 11, paddingHorizontal: 18, paddingTop: 6 }}>
          {MODES.find((m) => m.id === mode)?.label} on
        </Text>
      )}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8), alignItems: 'flex-end' }}>
        <TextInput
          style={{ flex: 1, maxHeight: 140, color: c.text, backgroundColor: c.card, borderRadius: 20, borderCurve: 'continuous', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, fontSize: 16 }}
          value={text}
          onChangeText={setText}
          placeholder={
            top?.kind === 'question' ? 'Or type your own answer' : top ? 'Or tell it what to do instead' : st?.busy ? (provider === 'codex' ? 'Steer the running turn…' : 'Queue a message…') : provider === 'claude' ? 'Message, or / for commands' : 'Message'
          }
          placeholderTextColor={c.dim}
          multiline
        />
        <Pressable onPress={submit} disabled={!text.trim()} style={({ pressed }) => ({ opacity: !text.trim() ? 0.35 : pressed ? 0.7 : 1 })}>
          <Icon name="arrow.up.circle.fill" size={36} color={c.accent} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const fmtTokens = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));

function Bubble({ m }: { m: Msg }) {
  if (m.role === 'user')
    return (
      <View style={{ alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: c.fill, borderRadius: 18, borderCurve: 'continuous', paddingHorizontal: 14, paddingVertical: 9, marginVertical: 4 }}>
        <Text selectable style={{ color: c.text, fontSize: 16, lineHeight: 22 }}>{m.text}</Text>
      </View>
    );
  if (m.role === 'tool')
    return (
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginVertical: 1 }}>
        <Icon name={toolIcon(m.tool)} size={12} color={c.accent} />
        <Text style={{ color: c.dim, fontSize: 13, flex: 1 }} numberOfLines={2}>
          <Text style={{ color: c.text, fontFamily: mono, fontSize: 12 }}>{m.tool}</Text>
          {m.text ? '  ' + m.text : ''}
        </Text>
      </View>
    );
  if (m.role === 'system') return <Text selectable style={{ color: c.dim, fontSize: 12, fontFamily: mono, marginVertical: 6, textAlign: 'center' }}>{m.text}</Text>;
  return <View style={{ marginVertical: 6 }}><Markdown text={m.text} /></View>;
}

const toolIcon = (t?: string) =>
  t === 'Bash' || t === 'Shell' ? 'terminal' : t === 'Edit' || t === 'Write' || t === 'MultiEdit' ? 'pencil' : t === 'Read' ? 'doc.text' : t === 'Grep' || t === 'Glob' ? 'magnifyingglass' : t?.startsWith('Web') ? 'globe' : 'wrench.and.screwdriver';

// permission/plan: tap an option. question: one at a time; multi-select collects
// labels until Done. The composer doubles as "something else".
function PromptCard({ p, more, answered, onChoose, onAnswer, onSkip }: {
  p: Prompt; more: number; answered: number; onChoose: (i: number) => void; onAnswer: (labels: string[]) => void; onSkip: () => void;
}) {
  const q = p.kind === 'question' ? p.questions?.[answered] : undefined;
  const [picked, setPicked] = useState<string[]>([]); // reset by the parent's key
  const options = q ? q.options : p.options ?? [];
  const tap = (i: number) => {
    Haptics.selectionAsync();
    if (!q) return onChoose(i);
    const label = q.options[i].label;
    if (!q.multiSelect) return onAnswer([label]);
    setPicked((x) => (x.includes(label) ? x.filter((y) => y !== label) : [...x, label]));
  };

  return (
    <View style={{ borderTopWidth: 2, borderColor: c.accent as any, backgroundColor: c.card, padding: 14, gap: 10, maxHeight: '65%' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={p.kind === 'plan' ? 'list.bullet.clipboard' : p.kind === 'question' ? 'questionmark.bubble' : 'hand.raised'} color={c.accent} />
        <Text style={{ flex: 1, color: c.text, fontSize: 16, fontWeight: '600' }}>{q ? q.header || p.title : p.title}</Text>
        {more > 0 && <Text style={{ color: c.dim, fontSize: 12 }}>+{more} more</Text>}
      </View>
      <ScrollView style={{ flexGrow: 0, maxHeight: p.kind === 'plan' ? 280 : 160 }}>
        {q ? (
          <Text selectable style={{ color: c.text, fontSize: 15 }}>{q.question}</Text>
        ) : p.kind === 'plan' ? (
          <Markdown text={p.body || ''} />
        ) : (
          !!p.body && <Text selectable style={{ color: c.dim, fontSize: 12, fontFamily: mono }}>{p.body}</Text>
        )}
      </ScrollView>
      <View style={{ gap: 6 }}>
        {options.map((o, i) => {
          const on = picked.includes(o.label);
          return (
            <Pressable key={i} onPress={() => tap(i)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderCurve: 'continuous', paddingHorizontal: 12, paddingVertical: 11, backgroundColor: on ? c.accent : c.bg, opacity: pressed ? 0.6 : 1 })}>
              {q?.multiSelect && <Icon name={on ? 'checkmark.square.fill' : 'square'} color={on ? '#fff' : c.dim} />}
              <View style={{ flex: 1 }}>
                <Text style={{ color: on ? '#fff' : c.text, fontWeight: '600' }}>{o.label}</Text>
                {!!o.desc && <Text style={{ color: on ? '#fff' : c.dim, fontSize: 12, marginTop: 2 }}>{o.desc}</Text>}
              </View>
            </Pressable>
          );
        })}
      </View>
      {!!q && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable onPress={onSkip} hitSlop={8}><Text style={{ color: c.red }}>Skip</Text></Pressable>
          {q.multiSelect && (
            <Pressable onPress={() => picked.length && onAnswer(picked)} hitSlop={8}>
              <Text style={{ color: picked.length ? c.accent : c.dim, fontWeight: '600' }}>Done</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
