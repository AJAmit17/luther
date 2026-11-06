import { memo, useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { api } from '@/lib/hosts';
import { LayoutAnimation, Pressable, Text, View } from 'react-native';
import { Markdown } from '@/components/markdown';
import { Icon, PulsingDot, c, card, mono, tint, type, useHex } from '@/components/ui';
import { workSummary, type Block } from '@/lib/blocks';
import type { Msg } from '@/lib/protocol';

const animate = (f: () => void) => {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  f();
};

export const toolIcon = (t?: string) =>
  t === 'Bash' || t === 'Shell'
    ? 'terminal'
    : t === 'Edit' || t === 'Write' || t === 'MultiEdit' || t === 'NotebookEdit'
      ? 'pencil'
      : t === 'Read'
        ? 'doc.text'
        : t === 'Grep' || t === 'Glob' || t === 'Search' || t === 'LS'
          ? 'magnifyingglass'
          : t?.startsWith('Web') || t === 'Fetch'
            ? 'globe'
            : t === 'Task' || t === 'Agent'
              ? 'person.2'
              : t === 'TodoWrite'
                ? 'checklist'
                : t === 'Think'
                  ? 'sparkle'
                  : 'wrench.and.screwdriver';

// Pictures sent with a message, fetched once per run (through the same, maybe
// encrypted, channel as every other request) and kept as data URIs.
const shown = new Map<string, Promise<string>>();
const picture = (name: string) => {
  let p = shown.get(name);
  if (!p) {
    p = api<{ type: string; data: string }>('/uploads/' + encodeURIComponent(name)).then((r) => `data:${r.type};base64,${r.data}`);
    p.catch(() => shown.delete(name)); // try again next time
    shown.set(name, p);
  }
  return p;
};

function SentImage({ name }: { name: string }) {
  useHex();
  const [uri, setUri] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    picture(name).then((u) => live && setUri(u), () => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [name]);
  return (
    <View style={{ width: 168, height: 168, borderRadius: 16, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' }}>
      {uri ? <Image source={{ uri }} style={{ width: 168, height: 168 }} contentFit="cover" accessibilityLabel="Attached image" /> : <Icon name={failed ? 'photo' : 'photo.on.rectangle'} size={22} color={c.faint} />}
    </View>
  );
}

function UserBubble({ text, images }: { text: string; images?: string[] }) {
  useHex();
  return (
    <View style={{ alignItems: 'flex-end', paddingLeft: 48, gap: 6 }}>
      {!!images?.length && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }}>
          {images.map((n) => (
            <SentImage key={n} name={n} />
          ))}
        </View>
      )}
      {!!text && (
        <Text selectable style={[type.callout, { lineHeight: 22, backgroundColor: c.muted, borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden', paddingHorizontal: 15, paddingVertical: 10 }]}>
          {text}
        </Text>
      )}
    </View>
  );
}

/** One step: the tool and what it touched, on one or two lines. */
export function StepRow({ m }: { m: Msg }) {
  useHex();
  if (m.role === 'assistant') return <Text style={[type.footnote, { color: c.dim }]} numberOfLines={4}>{m.text}</Text>;
  return (
    <View style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}>
      <View style={{ paddingTop: 2 }}>
        <Icon name={toolIcon(m.tool)} size={13} color={c.dim} />
      </View>
      <Text style={[type.footnote, { flex: 1, color: c.text }]} numberOfLines={2}>
        <Text style={{ fontFamily: mono, fontSize: 12, color: c.dim }}>{m.tool}</Text>
        {m.text ? '  ' + m.text : ''}
      </Text>
    </View>
  );
}

/** The agent's steps between two messages: one line when done, the live step while running. */
const WorkCard = memo(function WorkCard({ steps, live, activity }: { steps: Msg[]; live: boolean; activity?: string }) {
  useHex();
  const [open, setOpen] = useState(false);
  const last = steps[steps.length - 1];
  return (
    <View style={[card, { padding: 13, gap: 10 }]}>
      <Pressable onPress={() => animate(() => setOpen(!open))} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {live ? <PulsingDot /> : <Icon name="checkmark.circle" size={16} color={c.dim} />}
        <Text style={[type.subhead, { flex: 1, fontWeight: '500' }]} numberOfLines={1}>
          {live ? activity || 'Working…' : workSummary(steps)}
        </Text>
        <Text style={[type.caption, { fontVariant: ['tabular-nums'] }]}>{steps.length}</Text>
        <Icon name={open ? 'chevron.up' : 'chevron.down'} size={11} color={c.faint} />
      </Pressable>
      {open ? steps.map((s) => <StepRow key={s.id} m={s} />) : live && last ? <StepRow m={last} /> : null}
    </View>
  );
});

/** A subagent the agent started: its task, a peek at its latest step, all steps on tap. */
function AgentCard({ m, steps, live }: { m: Msg; steps: Msg[]; live: boolean }) {
  useHex();
  const [open, setOpen] = useState(false);
  const tools = steps.filter((s) => s.role === 'tool');
  const last = tools[tools.length - 1];
  return (
    <View style={[card, { overflow: 'hidden' }]}>
      <Pressable onPress={() => animate(() => setOpen(!open))} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13 }}>
        <Icon name="person.2.fill" size={16} color={c.dim} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.subhead, { fontWeight: '600' }]} numberOfLines={open ? undefined : 1}>{m.text || 'Subagent'}</Text>
          <Text style={type.caption}>Subagent · {tools.length} step{tools.length === 1 ? '' : 's'}</Text>
        </View>
        {live ? <PulsingDot size={7} /> : null}
        <Icon name={open ? 'chevron.up' : 'chevron.down'} size={11} color={c.faint} />
      </Pressable>
      {open ? (
        <View style={{ gap: 9, padding: 13, paddingTop: 11, borderTopWidth: 1, borderTopColor: c.line }}>
          {steps.length ? steps.map((s) => <StepRow key={s.id} m={s} />) : <Text style={type.footnote}>No steps shown.</Text>}
        </View>
      ) : last ? (
        <View style={{ paddingHorizontal: 13, paddingBottom: 12, marginTop: -4 }}>
          <StepRow m={last} />
        </View>
      ) : null}
    </View>
  );
}

function Notice({ text }: { text: string }) {
  useHex();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 24 }}>
      <View style={{ height: 1, flex: 1, backgroundColor: c.line }} />
      <Text selectable style={[type.caption, { textAlign: 'center', maxWidth: '75%' }]}>{text}</Text>
      <View style={{ height: 1, flex: 1, backgroundColor: c.line }} />
    </View>
  );
}

function ErrorRow({ text }: { text: string }) {
  useHex();
  return (
    <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderRadius: 14, borderCurve: 'continuous', backgroundColor: tint('red', 0.1) }}>
      <Icon name="exclamationmark.triangle.fill" size={15} color={c.red} />
      <Text selectable style={[type.subhead, { color: c.red, flex: 1 }]}>{text}</Text>
    </View>
  );
}

/** One block of the chat. */
export const BlockRow = memo(function BlockRow({ b, live, activity }: { b: Block; live: boolean; activity?: string }) {
  useHex();
  if (b.kind === 'work') return <WorkCard steps={b.steps} live={live} activity={activity} />;
  if (b.kind === 'agent') return <AgentCard m={b.m} steps={b.steps} live={live} />;
  const m = b.m;
  if (m.role === 'user') return <UserBubble text={m.text} images={m.images} />;
  if (m.role === 'system') return m.id.startsWith('err-') ? <ErrorRow text={m.text} /> : <Notice text={m.text} />;
  if (m.role === 'tool') return <StepRow m={m} />;
  return <Markdown text={m.text} />;
});
