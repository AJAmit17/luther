import { View } from 'react-native';
import { Image } from 'expo-image';
import { Chip, Icon, Segmented, Text, Tile, Press, Surface, space, useTheme, type IconName } from '@/design';
import type { Mode, Provider } from '@/lib/protocol';

type Mark = { name: string; src: number; tint?: boolean };

const AGENTS: Record<Provider, Mark> = {
  claude: { name: 'Claude', src: require('../../assets/agents/claude.png') },
  codex: { name: 'Codex', src: require('../../assets/agents/codex.png'), tint: true },
  opencode: { name: 'OpenCode', src: require('../../assets/agents/opencode.png'), tint: true },
  gemini: { name: 'Gemini', src: require('../../assets/agents/gemini.png') },
  cursor: { name: 'Cursor', src: require('../../assets/agents/cursor.png'), tint: true },
  devin: { name: 'Devin', src: require('../../assets/agents/devin.png'), tint: true },
  omp: { name: 'Oh My Pi', src: require('../../assets/agents/omp.png') },
};

export const agentName = (p: Provider) => AGENTS[p]?.name ?? p;

export const MODES: { id: Mode; label: string; short: string; desc: string; icon: IconName }[] = [
  { id: 'ask', label: 'Ask First', short: 'Ask', desc: 'Approve edits and commands', icon: 'hand.raised' },
  { id: 'edits', label: 'Auto-Accept Edits', short: 'Edits', desc: 'Commands still ask', icon: 'pencil' },
  { id: 'plan', label: 'Plan', short: 'Plan', desc: 'Read-only until you approve a plan', icon: 'list.bullet.clipboard' },
  { id: 'full', label: 'Full Access', short: 'Full', desc: 'No prompts at all', icon: 'exclamationmark.shield' },
];

export const modeOf = (m: Mode) => MODES.find((x) => x.id === m) ?? MODES[0];

/** An agent's own logo; monochrome ones take the text colour. */
export function AgentMark({ p, size = 16, color }: { p: Provider; size?: number; color?: string }) {
  const theme = useTheme();
  const mark = AGENTS[p];
  if (!mark) return <Icon name="cpu" size={size} color={color} />;
  return <Image source={mark.src} style={{ width: size, height: size }} tintColor={mark.tint ? (color ?? theme.color.text) : undefined} contentFit="contain" accessibilityLabel={mark.name} />;
}

export const AgentTile = ({ p, size = 36 }: { p: Provider; size?: number }) => (
  <Tile size={size}>
    <AgentMark p={p} size={size * 0.52} />
  </Tile>
);

/** One agent as chips, or several (`multiple`) as tiles with checks and an optional detail line. */
export function AgentPicker({ agents, value, onChange, multiple, details }: {
  agents: Provider[];
  value: Provider[];
  onChange: (v: Provider[]) => void;
  multiple?: boolean;
  details?: Partial<Record<Provider, string>>;
}) {
  const { color } = useTheme();
  if (!multiple)
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs + 2 }}>
        {agents.map((p) => (
          <Chip key={p} label={agentName(p)} leading={<AgentMark p={p} size={18} />} selected={value.includes(p)} onPress={() => onChange([p])} />
        ))}
      </View>
    );
  const toggle = (p: Provider) => onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {agents.map((p) => {
        const on = value.includes(p);
        return (
          <Press key={p} onPress={() => toggle(p)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={agentName(p)} style={{ width: '31%', flexGrow: 1 }}>
            <Surface style={[{ padding: space.md, gap: space.sm }, on && { borderColor: color.accent, borderWidth: 1.5, backgroundColor: color.card }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <AgentMark p={p} size={24} />
                {on && <Icon name="checkmark.circle.fill" size={18} color={color.accent} />}
              </View>
              <View>
                <Text variant="subhead" weight="medium">{agentName(p)}</Text>
                {!!details?.[p] && <Text variant="caption" numberOfLines={1}>{details[p]}</Text>}
              </View>
            </Surface>
          </Press>
        );
      })}
    </View>
  );
}

/** The four permission modes, with a line saying what the chosen one means. */
export function ModePicker({ value, onChange, provider }: { value: Mode; onChange: (m: Mode) => void; provider?: Provider }) {
  const desc = provider === 'devin' && value === 'ask' ? 'Devin’s native Ask mode is read-only' : modeOf(value).desc;
  return (
    <View style={{ gap: space.xs + 2 }}>
      <Segmented options={MODES.map((m) => ({ id: m.id, label: m.short }))} value={value} onChange={onChange} />
      <Text variant="footnote" color={value === 'full' ? 'red' : 'dim'} style={{ paddingHorizontal: space.lg }}>{desc}</Text>
    </View>
  );
}
