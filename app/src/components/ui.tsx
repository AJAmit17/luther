import { useCallback, useState, type ReactNode } from 'react';
import { PlatformColor, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import type { Mode, Provider } from '@/lib/protocol';
import { keep, peek } from '@/lib/cache';

// iOS system colors: light/dark follow the phone automatically.
export const c = {
  text: PlatformColor('label'),
  dim: PlatformColor('secondaryLabel'),
  faint: PlatformColor('tertiaryLabel'),
  bg: PlatformColor('systemBackground'),
  card: PlatformColor('secondarySystemBackground'),
  fill: PlatformColor('tertiarySystemFill'),
  line: PlatformColor('separator'),
  accent: PlatformColor('systemOrange'),
  blue: PlatformColor('systemBlue'),
  green: PlatformColor('systemGreen'),
  red: PlatformColor('systemRed'),
};

export const mono = 'Menlo';

export const home = (p: string) => p.replace(/^\/Users\/[^/]+/, '~');

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

export const Icon = ({ name, size = 18, color = c.dim }: { name: string; size?: number; color?: any }) => (
  <Image source={`sf:${name}`} style={{ width: size, height: size }} tintColor={color as any} />
);

export function Row({ title, sub, icon, right, onPress, onLongPress }: {
  title: string; sub?: string; icon?: ReactNode; right?: ReactNode; onPress?: () => void; onLongPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: pressed ? c.fill : 'transparent' })}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '500' }} numberOfLines={1}>{title}</Text>
        {!!sub && <Text style={{ color: c.dim, fontSize: 13 }} numberOfLines={2}>{sub}</Text>}
      </View>
      {right}
    </Pressable>
  );
}

export function Button({ label, onPress, kind = 'plain', icon, disabled }: {
  label: string; onPress: () => void; kind?: 'plain' | 'accent' | 'danger'; icon?: string; disabled?: boolean;
}) {
  const fg = kind === 'accent' ? '#fff' : kind === 'danger' ? c.red : c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({ flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, borderCurve: 'continuous', backgroundColor: kind === 'accent' ? c.accent : c.card, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 })}
    >
      {!!icon && <Icon name={icon} size={16} color={fg} />}
      <Text style={{ color: fg, fontWeight: '600', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

export const Badge = ({ label, color = c.dim }: { label: string; color?: any }) => (
  <Text style={{ color, borderColor: color, fontSize: 11, fontWeight: '600', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' }}>{label}</Text>
);

const PROVIDERS: Record<Provider, { name: string; icon: string; color: any }> = {
  claude: { name: 'Claude', icon: 'sparkle', color: c.accent },
  codex: { name: 'Codex', icon: 'chevron.left.forwardslash.chevron.right', color: c.blue },
  opencode: { name: 'OpenCode', icon: 'curlybraces', color: c.green },
  gemini: { name: 'Gemini', icon: 'diamond', color: PlatformColor('systemIndigo') },
  cursor: { name: 'Cursor', icon: 'cursorarrow', color: PlatformColor('systemTeal') },
};
const info = (p: Provider) => PROVIDERS[p] ?? { name: p, icon: 'cpu', color: c.dim };
export const providerIcon = (p: Provider) => info(p).icon;
export const providerName = (p: Provider) => info(p).name;

export const ProviderIcon = ({ p }: { p: Provider }) => (
  <View style={{ width: 30, height: 30, borderRadius: 8, borderCurve: 'continuous', backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
    <Icon name={providerIcon(p)} size={15} color={info(p).color} />
  </View>
);

export const Note = ({ children, error }: { children: ReactNode; error?: boolean }) => (
  <Text selectable style={{ color: error ? c.red : c.dim, padding: 16, textAlign: 'center', fontSize: 14 }}>{children}</Text>
);

export const Banner = ({ text, error, onPress }: { text: string; error?: boolean; onPress?: () => void }) => (
  <Pressable onPress={onPress} style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: c.card }}>
    <Text selectable style={{ color: error ? c.red : c.dim, textAlign: 'center', fontSize: 13 }}>{text}</Text>
  </Pressable>
);

export const Section = ({ title }: { title: string }) => (
  <Text style={{ color: c.dim, fontSize: 13, fontWeight: '600', paddingHorizontal: 16, paddingTop: 22, paddingBottom: 6, textTransform: 'uppercase', backgroundColor: c.bg }}>{title}</Text>
);

// useLoad: runs fn on every focus (lists go stale while you're elsewhere) and on pull-to-refresh.
// With `cache` (a name for this list), the last answer shows at once, even after a relaunch.
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], cache?: string) {
  const key = JSON.stringify(deps);
  const ck = cache && `${cache}:${key}`;
  const [data, setData] = useState<T | null>(() => (ck ? peek<T>(ck) ?? null : null));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    if (ck) {
      const kept = peek<T>(ck);
      if (kept !== undefined) setData(kept);
    }
    setLoading(true);
    fn().then((d) => { setData(d); setError(''); if (ck) keep(ck, d); }, (e) => setError(String(e.message ?? e))).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ck]);
  useFocusEffect(load);
  return { data, error, loading, load };
}

export const MODES: { id: Mode; label: string; desc: string; icon: string }[] = [
  { id: 'ask', label: 'Ask first', desc: 'Approve edits and commands', icon: 'hand.raised' },
  { id: 'edits', label: 'Auto-accept edits', desc: 'Commands still ask', icon: 'pencil' },
  { id: 'plan', label: 'Plan', desc: 'Read-only until you approve a plan', icon: 'list.bullet.clipboard' },
  { id: 'full', label: 'Full access', desc: 'No prompts at all', icon: 'exclamationmark.shield' },
];
