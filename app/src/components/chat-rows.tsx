import { memo, useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { api } from '@/lib/hosts';
import { openArtifact } from '@/lib/artifacts';
import { isReading, readAloud, stopReading } from '@/lib/speech';
import { LayoutAnimation, View } from 'react-native';
import { Markdown } from '@/components/markdown';
import { Icon, Press, Span, Spinner, StatusDot, Surface, Text, alert, radius, space, tint, useTheme, type IconName } from '@/design';
import { workSummary, type Block } from '@/lib/blocks';
import type { Msg } from '@/lib/protocol';

const animate = (f: () => void) => {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  f();
};

export const toolIcon = (t?: string): IconName =>
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
  const { color } = useTheme();
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
    <View style={{ width: 168, height: 168, borderRadius: radius.card, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: color.muted, alignItems: 'center', justifyContent: 'center' }}>
      {uri ? <Image source={{ uri }} style={{ width: 168, height: 168 }} contentFit="cover" accessibilityLabel="Attached image" /> : <Icon name={failed ? 'photo' : 'photo.on.rectangle'} size={22} color={color.faint} />}
    </View>
  );
}

function UserBubble({ text, images }: { text: string; images?: string[] }) {
  const { color } = useTheme();
  return (
    <View style={{ alignItems: 'flex-end', paddingLeft: space.xxl + space.lg, gap: space.xs + 2 }}>
      {!!images?.length && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: space.xs + 2 }}>
          {images.map((n) => (
            <SentImage key={n} name={n} />
          ))}
        </View>
      )}
      {!!text && (
        <Text selectable variant="callout" style={{ lineHeight: 22, backgroundColor: color.muted, borderRadius: radius.sheet, borderCurve: 'continuous', overflow: 'hidden', paddingHorizontal: space.md + 3, paddingVertical: space.sm + 2 }}>
          {text}
        </Text>
      )}
    </View>
  );
}

/** One step: the tool and what it touched, on one or two lines. */
export function StepRow({ m }: { m: Msg }) {
  const { color } = useTheme();
  if (m.role === 'assistant') return <Text variant="footnote" numberOfLines={4}>{m.text}</Text>;
  return (
    <View style={{ flexDirection: 'row', gap: space.sm + 1, alignItems: 'flex-start' }}>
      <View style={{ paddingTop: 2 }}>
        <Icon name={toolIcon(m.tool)} size={13} color={color.dim} />
      </View>
      <Text variant="footnote" color="text" style={{ flex: 1 }} numberOfLines={2}>
        <Span mono color="dim">{m.tool}</Span>
        {m.text ? '  ' + m.text : ''}
      </Text>
    </View>
  );
}

const Chevron = ({ open }: { open: boolean }) => {
  const { color } = useTheme();
  return <Icon name={open ? 'chevron.up' : 'chevron.down'} size={11} color={color.faint} />;
};

/** The agent's steps between two messages: one line when done, the live step while running. */
const WorkCard = memo(function WorkCard({ steps, live, activity }: { steps: Msg[]; live: boolean; activity?: string }) {
  const { color } = useTheme();
  const [open, setOpen] = useState(false);
  const last = steps[steps.length - 1];
  return (
    <Surface style={{ padding: space.md + 1, gap: space.sm + 2 }}>
      <Press onPress={() => animate(() => setOpen(!open))} scale={1} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + 2 }}>
        {live ? <StatusDot color={color.accent} live /> : <Icon name="checkmark.circle" size={16} color={color.dim} />}
        <Text variant="subhead" weight="medium" style={{ flex: 1 }} numberOfLines={1}>
          {live ? activity || 'Working…' : workSummary(steps)}
        </Text>
        <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>{steps.length}</Text>
        <Chevron open={open} />
      </Press>
      {open ? steps.map((s) => <StepRow key={s.id} m={s} />) : live && last ? <StepRow m={last} /> : null}
    </Surface>
  );
});

/** A subagent the agent started: its task, a peek at its latest step, all steps on tap. */
function AgentCard({ m, steps, live }: { m: Msg; steps: Msg[]; live: boolean }) {
  const { color } = useTheme();
  const [open, setOpen] = useState(false);
  const tools = steps.filter((s) => s.role === 'tool');
  const last = tools[tools.length - 1];
  return (
    <Surface style={{ overflow: 'hidden' }}>
      <Press onPress={() => animate(() => setOpen(!open))} scale={1} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, padding: space.md + 1 }}>
        <Icon name="person.2.fill" size={16} color={color.dim} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="subhead" weight="medium" numberOfLines={open ? undefined : 1}>{m.text || 'Subagent'}</Text>
          <Text variant="caption">Subagent · {tools.length} step{tools.length === 1 ? '' : 's'}</Text>
        </View>
        {live ? <StatusDot color={color.accent} live size={7} /> : null}
        <Chevron open={open} />
      </Press>
      {open ? (
        <View style={{ gap: space.sm + 1, padding: space.md + 1, paddingTop: space.md - 1, borderTopWidth: 1, borderTopColor: color.line }}>
          {steps.length ? steps.map((s) => <StepRow key={s.id} m={s} />) : <Text variant="footnote">No steps shown.</Text>}
        </View>
      ) : last ? (
        <View style={{ paddingHorizontal: space.md + 1, paddingBottom: space.md, marginTop: -space.xs }}>
          <StepRow m={last} />
        </View>
      ) : null}
    </Surface>
  );
}

/** A page the agent made (show_artifact): opens in a Safari sheet, fresh each time. */
function ArtifactCard({ m }: { m: Msg }) {
  const { color } = useTheme();
  const [opening, setOpening] = useState(false);
  const open = () => {
    setOpening(true);
    openArtifact(m.id, m.text).finally(() => setOpening(false));
  };
  return (
    <Press onPress={open} accessibilityRole="button" accessibilityLabel={`Open ${m.text}`}>
      <Surface style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md + 1 }}>
        <View style={{ width: 36, height: 36, borderRadius: radius.control + 2, borderCurve: 'continuous', backgroundColor: tint(color.accent, 0.12), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="doc.richtext" size={18} color={color.accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="subhead" weight="medium" numberOfLines={2}>{m.text || 'Page'}</Text>
          <Text variant="caption">Page · opens in Safari</Text>
        </View>
        {opening ? <Spinner /> : <Icon name="arrow.up.right.square" size={16} color={color.faint} />}
      </Surface>
    </Press>
  );
}

function Notice({ text }: { text: string }) {
  const { color } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs + 2, paddingHorizontal: space.xl }}>
      <View style={{ height: 1, flex: 1, backgroundColor: color.line }} />
      <Text selectable variant="caption" style={{ textAlign: 'center', maxWidth: '75%' }}>{text}</Text>
      <View style={{ height: 1, flex: 1, backgroundColor: color.line }} />
    </View>
  );
}

function ErrorRow({ text }: { text: string }) {
  const { color } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.control, borderCurve: 'continuous', backgroundColor: tint(color.red, 0.1) }}>
      <Icon name="exclamationmark.triangle.fill" size={15} color={color.red} />
      <Text selectable variant="subhead" color="red" style={{ flex: 1 }}>{text}</Text>
    </View>
  );
}

/** An agent's reply; long-press to hear it. */
function Reply({ m }: { m: Msg }) {
  const menu = () =>
    isReading(m.id)
      ? stopReading()
      : alert('Read aloud?', undefined, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Read aloud', onPress: () => readAloud(m.id, m.text) },
        ]);
  return (
    <Press onLongPress={menu} delayLongPress={350} scale={1} dim={1} accessibilityHint="Long-press to read it aloud">
      <Markdown text={m.text} />
    </Press>
  );
}

/** One block of the chat. */
export const BlockRow = memo(function BlockRow({ b, live, activity }: { b: Block; live: boolean; activity?: string }) {
  if (b.kind === 'work') return <WorkCard steps={b.steps} live={live} activity={activity} />;
  if (b.kind === 'agent') return <AgentCard m={b.m} steps={b.steps} live={live} />;
  const m = b.m;
  if (m.role === 'user') return <UserBubble text={m.text} images={m.images} />;
  if (m.role === 'system') return m.id.startsWith('err-') ? <ErrorRow text={m.text} /> : <Notice text={m.text} />;
  if (m.role === 'tool') return <StepRow m={m} />;
  if (m.role === 'artifact') return <ArtifactCard m={m} />;
  return <Reply m={m} />;
});
