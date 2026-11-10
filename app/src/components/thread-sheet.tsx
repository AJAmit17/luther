import { useState } from 'react';
import { View } from 'react-native';
import { ModelPicker, modelName } from '@/components/model-picker';
import { Thinking, type ThinkingProps } from '@/components/thinking';
import { Group, Icon, ListItem, SectionHeader, Sheet, space, useTheme } from '@/design';
import { AgentMark, ModePicker, agentName } from '@/features/agents';
import type { Mode, Model, Provider, Usage } from '@/lib/protocol';
import { formatTokens as fmt } from '@/lib/usage';

// The thread's knobs in one sheet, opened from the composer's single pill:
// model, thinking, permissions, and what the thread has used so far.
export function ThreadSheet(p: {
  open: boolean;
  onClose: () => void;
  provider?: Provider;
  model: string;
  models: Model[];
  setModel: (m: string) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  think?: ThinkingProps;
  usage?: Usage | null;
}) {
  const { color } = useTheme();
  const [picking, setPicking] = useState(false);
  const showThink = !!p.think && (p.think.efforts.length > 0 || !!p.think.fast);
  return (
    <Sheet open={p.open} onClose={p.onClose} title={p.provider ? agentName(p.provider) : 'This Thread'} leading={p.provider ? <AgentMark p={p.provider} size={22} /> : undefined}>
      <Group title="Model">
        <ListItem icon="cpu" title={modelName(p.models, p.model) || 'Default'} onPress={() => setPicking(true)} trailing={<Icon name="chevron.up.chevron.down" size={13} color={color.faint} />} />
      </Group>

      {showThink && (
        <View style={{ gap: space.xs + 2 }}>
          <SectionHeader title="Thinking" />
          <Thinking {...p.think!} />
        </View>
      )}

      <View style={{ gap: space.xs + 2 }}>
        <SectionHeader title="Permissions" />
        <ModePicker value={p.mode} onChange={p.setMode} provider={p.provider} />
      </View>

      {!!p.usage && (
        <Group title="This Thread So Far">
          <ListItem icon="arrow.down" title="Tokens In" value={fmt(p.usage.inputTokens)} />
          <ListItem icon="arrow.up" title="Tokens Out" value={fmt(p.usage.outputTokens)} />
          {!!p.usage.cacheReadTokens && <ListItem icon="arrow.triangle.2.circlepath" title="Read from Cache" value={fmt(p.usage.cacheReadTokens)} />}
          {!!p.usage.costUsd && <ListItem icon="dollarsign" title="Reported Cost" value={`$${p.usage.costUsd.toFixed(2)}`} />}
        </Group>
      )}

      <ModelPicker open={picking} models={p.models} selected={p.model} onPick={p.setModel} onClose={() => setPicking(false)} />
    </Sheet>
  );
}
