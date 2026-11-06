import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, DynamicColorIOS, Pressable, StyleSheet, Text, View, useColorScheme, type ColorValue, type TextStyle, type ViewStyle } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import type { Mode, Provider } from '@/lib/protocol';
import { keep, peek } from '@/lib/cache';
import { PALETTE as P } from '@/lib/palette';

// Luther's look: mineral neutrals and Relay teal, with a separate foreground
// for filled actions. Amber marks what needs you; red remains destructive.
// The approved Relay geometry and palette also drive the generated assets.
// Colours follow the phone's appearance by themselves (iOS dynamic
// colours), so nothing re-renders on a switch.

type Pair = readonly [light: string, dark: string];

const ios = process.env.EXPO_OS === 'ios';
const dyn = ([light, dark]: Pair): ColorValue => (ios ? DynamicColorIOS({ light, dark }) : dark);
const hexA = (hex: string, a: number) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

/** Both schemes as hex (previews in Settings → Appearance). */
export const palettes = { light: Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v[0]])), dark: Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v[1]])) } as Record<'light' | 'dark', Record<keyof typeof P, string>>;

export const c = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, dyn(v)])) as Record<keyof typeof P, ColorValue>;

/** The palette as plain hex for the active scheme: for native props (headers,
 *  tab bar, status bar) that don't resolve adaptive colours. */
export function useHex(): Record<keyof typeof P, string> & { dark: boolean } {
  const dark = useColorScheme() !== 'light';
  return { ...(Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v[dark ? 1 : 0]])) as Record<keyof typeof P, string>), dark };
}

/** A palette colour at an opacity (pill and button backgrounds). */
export const tint = (k: keyof typeof P, a: number) => dyn([hexA(P[k][0], a), hexA(P[k][1], a)]);

export const mono = 'Menlo';

/** iOS text styles, so sizes match native screens. */
export const type = {
  title: { fontSize: 28, fontWeight: '700', color: c.text },
  title2: { fontSize: 22, fontWeight: '700', color: c.text },
  title3: { fontSize: 20, fontWeight: '600', color: c.text },
  headline: { fontSize: 17, fontWeight: '600', color: c.text },
  body: { fontSize: 17, lineHeight: 23, color: c.text },
  callout: { fontSize: 16, lineHeight: 22, color: c.text },
  subhead: { fontSize: 15, lineHeight: 20, color: c.text },
  footnote: { fontSize: 13, lineHeight: 18, color: c.dim },
  caption: { fontSize: 12, lineHeight: 16, color: c.dim },
  caption2: { fontSize: 11, lineHeight: 13, color: c.dim },
} satisfies Record<string, TextStyle>;

export const card: ViewStyle = { backgroundColor: c.card, borderRadius: 16, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, borderColor: c.line };

/** contentContainerStyle for a list of card rows. */
export const listStyle: ViewStyle = { padding: 16, gap: 8, paddingBottom: 40 };

export const home = (p: string) => p.replace(/^\/(Users|home)\/[^/]+/, '~').replace(/^\/root(?=\/|$)/, '~');

/** "in 3h" until a future time (ms). */
export function until(t: number) {
  const sec = (t - Date.now()) / 1000;
  if (sec <= 60) return 'any moment';
  if (sec < 3600) return `in ${Math.round(sec / 60)}m`;
  if (sec < 86400) return `in ${Math.round(sec / 3600)}h`;
  return `in ${Math.round(sec / 86400)}d`;
}

export function ago(t: string | number) {
  const sec = (Date.now() - new Date(t).getTime()) / 1000;
  if (sec < 60) return 'now';
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

export const Icon = ({ name, size = 18, color = c.dim }: { name: string; size?: number; color?: ColorValue }) => (
  <Image source={`sf:${name}`} style={{ width: size, height: size }} tintColor={color as string} />
);

/** The "agent is working" dot. */
export function PulsingDot({ size = 8, color = c.accent }: { size?: number; color?: ColorValue }) {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View accessibilityLabel="Working" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity }} />;
}

export const Dot = ({ color, size = 6 }: { color: ColorValue; size?: number }) => <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;

type Tone = 'accent' | 'green' | 'blue' | 'red' | 'warn' | 'dim';
/** A state capsule: a dot (live: pulsing) and a word. */
export function Pill({ label, tone = 'dim', live, icon }: { label: string; tone?: Tone; live?: boolean; icon?: string }) {
  const color = c[tone];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: tint(tone, 0.14) }}>
      {icon ? <Icon name={icon} size={10} color={color} /> : live ? <PulsingDot size={6} color={color} /> : <Dot color={color} />}
      <Text style={[type.caption2, { fontWeight: '600', color }]}>{label}</Text>
    </View>
  );
}

/** Kept for older call sites: a quiet pill. */
export const Badge = ({ label, color }: { label: string; color?: ColorValue }) => (
  <Pill label={label} tone={color === c.green ? 'green' : color === c.accent ? 'accent' : color === c.blue ? 'blue' : color === c.red ? 'red' : 'dim'} />
);

/** A card row: icon, title and detail, something on the right. A long press opens `menu`. */
export function Row({ title, sub, icon, right, onPress, onLongPress, menu, onMenu, subLines = 2 }: {
  title: string;
  sub?: string;
  icon?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  menu?: MenuAction[];
  onMenu?: (id: string) => void;
  subLines?: number;
}) {
  const body = (
    <Pressable onPress={onPress} onLongPress={menu ? undefined : onLongPress} style={({ pressed }) => [card, { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13, opacity: pressed ? 0.7 : 1 }]}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.callout, { fontWeight: '600' }]} numberOfLines={1}>{title}</Text>
        {!!sub && <Text style={type.footnote} numberOfLines={subLines}>{sub}</Text>}
      </View>
      {right}
    </Pressable>
  );
  if (!menu) return body;
  return (
    <MenuView actions={menu} shouldOpenOnLongPress onPressAction={({ nativeEvent }) => onMenu?.(nativeEvent.event)}>
      {body}
    </MenuView>
  );
}

/** A Settings-style group: rows inside one rounded card, with a title above and a footer below. */
export function Group({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      {!!title && <SectionTitle>{title}</SectionTitle>}
      <View style={[card, { overflow: 'hidden' }]}>{children}</View>
      {!!footer && <Text style={[type.footnote, { paddingHorizontal: 16 }]}>{footer}</Text>}
    </View>
  );
}

/** One row of a Group. `first` drops the separator above it. */
export function GroupRow({ label, value, icon, iconColor, onPress, right, first, destructive, sub }: {
  label: string;
  value?: string;
  icon?: string;
  iconColor?: ColorValue;
  onPress?: () => void;
  right?: ReactNode;
  first?: boolean;
  destructive?: boolean;
  sub?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 48, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth, borderTopColor: c.line, backgroundColor: pressed ? c.muted : 'transparent' })}
    >
      {!!icon && <Icon name={icon} size={17} color={iconColor ?? (destructive ? c.red : c.text)} />}
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={[type.body, destructive && { color: c.red }]} numberOfLines={1}>{label}</Text>
        {!!sub && <Text style={type.footnote} numberOfLines={2}>{sub}</Text>}
      </View>
      {!!value && <Text selectable numberOfLines={1} style={[type.body, { color: c.dim, flexShrink: 1, textAlign: 'right' }]}>{value}</Text>}
      {right ?? (onPress && !destructive ? <Icon name="chevron.right" size={13} color={c.faint} /> : null)}
    </Pressable>
  );
}

export function Button({ label, onPress, kind = 'plain', icon, disabled, busy }: {
  label: string; onPress: () => void; kind?: 'plain' | 'accent' | 'danger'; icon?: string; disabled?: boolean; busy?: boolean;
}) {
  const fg = kind === 'accent' ? c.onAccent : kind === 'danger' ? c.red : c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 14, borderRadius: 14, borderCurve: 'continuous', backgroundColor: kind === 'accent' ? c.accent : kind === 'danger' ? tint('red', 0.12) : c.muted, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 })}
    >
      {busy ? <ActivityIndicator size="small" color={fg as string} /> : icon ? <Icon name={icon} size={16} color={fg} /> : null}
      <Text style={[type.headline, { color: fg, fontSize: 16 }]}>{label}</Text>
    </Pressable>
  );
}

/** A quiet capsule button for secondary actions inside cards. */
export function TextButton({ label, onPress, tone = 'accent', icon }: { label: string; onPress: () => void; tone?: Tone; icon?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: tint(tone, pressed ? 0.24 : 0.13) })}>
      {!!icon && <Icon name={icon} size={12} color={c[tone]} />}
      <Text style={[type.footnote, { color: c[tone], fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

const PROVIDERS: Record<Provider, { name: string; icon: string; color: ColorValue }> = {
  claude: { name: 'Claude', icon: 'sparkle', color: c.accent },
  codex: { name: 'Codex', icon: 'chevron.left.forwardslash.chevron.right', color: c.blue },
  opencode: { name: 'OpenCode', icon: 'curlybraces', color: c.green },
  gemini: { name: 'Gemini', icon: 'diamond', color: dyn(['#5B4BD6', '#9C8CFF']) },
  cursor: { name: 'Cursor', icon: 'cursorarrow', color: dyn(['#0E7C86', '#4FD1DB']) },
};
const info = (p: Provider) => PROVIDERS[p] ?? { name: p, icon: 'cpu', color: c.dim };
export const providerIcon = (p: Provider) => info(p).icon;
export const providerName = (p: Provider) => info(p).name;
export const providerColor = (p: Provider) => info(p).color;

// The agents' own marks (Simple Icons, CC0): Claude's for Claude Code, OpenAI's
// (monochrome, tinted to the text colour) for Codex. Others get an SF Symbol.
const MARKS: Partial<Record<Provider, { src: number; tint?: boolean }>> = {
  claude: { src: require('../../assets/agents/claude.png') },
  codex: { src: require('../../assets/agents/codex.png'), tint: true },
};

/** An agent's logo at `size`, or its symbol. */
export function ProviderMark({ p, size = 16, color }: { p: Provider; size?: number; color?: ColorValue }) {
  const m = MARKS[p];
  if (!m) return <Icon name={providerIcon(p)} size={size} color={color ?? info(p).color} />;
  return <Image source={m.src} style={{ width: size, height: size }} tintColor={m.tint ? ((color ?? c.text) as string) : undefined} contentFit="contain" />;
}

export const ProviderIcon = ({ p, size = 34 }: { p: Provider; size?: number }) => (
  <View style={{ width: size, height: size, borderRadius: size * 0.3, borderCurve: 'continuous', backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' }}>
    <ProviderMark p={p} size={size * 0.52} />
  </View>
);

/** An icon in a rounded square, like Settings' row icons. */
export const IconTile = ({ name, color = c.dim, size = 34 }: { name: string; color?: ColorValue; size?: number }) => (
  <View style={{ width: size, height: size, borderRadius: size * 0.3, borderCurve: 'continuous', backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' }}>
    <Icon name={name} size={size * 0.5} color={color} />
  </View>
);

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingTop: 10 }}>
      <Text style={[type.footnote, { flex: 1, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 }]}>{children}</Text>
      {right}
    </View>
  );
}

/** Kept name: a section heading inside a list. */
export const Section = ({ title }: { title: string }) => (
  <View style={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6, backgroundColor: c.bg }}>
    <SectionTitle>{title}</SectionTitle>
  </View>
);

/** SwiftUI's ContentUnavailableView: a big symbol, a title, a line. */
export function Empty({ icon, title, sub, action }: { icon: string; title: string; sub?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32, paddingVertical: 48 }}>
      <Icon name={icon} size={44} color={c.faint} />
      <Text style={[type.title3, { textAlign: 'center', marginTop: 6 }]}>{title}</Text>
      {!!sub && <Text style={[type.subhead, { color: c.dim, textAlign: 'center' }]}>{sub}</Text>}
      {action}
    </View>
  );
}

export const Note = ({ children, error }: { children: ReactNode; error?: boolean }) =>
  error ? (
    <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderRadius: 12, borderCurve: 'continuous', backgroundColor: tint('red', 0.1) }}>
      <Icon name="exclamationmark.triangle.fill" size={15} color={c.red} />
      <Text selectable style={[type.footnote, { color: c.red, flex: 1 }]}>{children}</Text>
    </View>
  ) : (
    <Text selectable style={[type.footnote, { textAlign: 'center', padding: 12 }]}>{children}</Text>
  );

/** A slim status strip (connection, warnings). */
export const Banner = ({ text, error, onPress, icon }: { text: string; error?: boolean; onPress?: () => void; icon?: string }) => (
  <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 14, backgroundColor: error ? tint('red', 0.12) : c.muted }}>
    {!!icon && <Icon name={icon} size={12} color={error ? c.red : c.dim} />}
    <Text selectable style={[type.footnote, { color: error ? c.red : c.dim, textAlign: 'center' }]}>{text}</Text>
  </Pressable>
);

// useLoad: runs fn on every focus (lists go stale while you're elsewhere) and on pull-to-refresh.
// With `cache` (a name for this list), the last answer shows at once, even after a relaunch.
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], cache?: string) {
  const key = JSON.stringify(deps);
  const ck = cache && `${cache}:${key}`;
  const [data, setData] = useState<T | null>(() => (ck ? peek<T>(ck) ?? null : null));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const seq = useRef(0); // only the latest request's answer lands
  const shownKey = useRef(key);
  const load = useCallback(() => {
    const kept = ck ? peek<T>(ck) : undefined;
    if (kept !== undefined) setData(kept);
    else if (shownKey.current !== key) setData(null); // never show another key's answer
    shownKey.current = key;
    const my = ++seq.current;
    setLoading(true);
    fn()
      .then(
        (d) => {
          if (my !== seq.current) return;
          setData(d);
          setError('');
          if (ck) keep(ck, d);
        },
        (e) => {
          if (my === seq.current) setError(String(e.message ?? e));
        },
      )
      .finally(() => {
        if (my !== seq.current) return;
        setLoading(false);
        setPulling(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ck]);
  useFocusEffect(load);
  // For <RefreshControl {...pull} />: the spinner shows only for a pull, never for
  // a focus reload (a spinner switched on at mount shifts iOS's list insets).
  const pull = {
    refreshing: pulling,
    onRefresh: () => {
      setPulling(true);
      load();
    },
  };
  return { data, error, loading, load, pull };
}

export const MODES: { id: Mode; label: string; desc: string; icon: string }[] = [
  { id: 'ask', label: 'Ask first', desc: 'Approve edits and commands', icon: 'hand.raised' },
  { id: 'edits', label: 'Auto-accept edits', desc: 'Commands still ask', icon: 'pencil' },
  { id: 'plan', label: 'Plan', desc: 'Read-only until you approve a plan', icon: 'list.bullet.clipboard' },
  { id: 'full', label: 'Full access', desc: 'No prompts at all', icon: 'exclamationmark.shield' },
];
