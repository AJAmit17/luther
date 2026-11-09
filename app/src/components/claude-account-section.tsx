import { useState } from 'react';
import { Alert } from 'react-native';
import { api, currentHostIdSync } from '@/lib/hosts';
import type { ClaudeAccounts } from '@/lib/protocol';
import { Group, GroupRow, Icon, c, useLoad, useHex } from '@/components/ui';

// Which Claude account new Claude threads run under: the claude CLI's own login
// (Terminal) or one added on the Mac with `luther claude-account add`. Shown
// only once there is a second account; tokens never reach the phone.
export function ClaudeAccountSection() {
  useHex();
  const host = currentHostIdSync();
  const { data } = useLoad(() => api<ClaudeAccounts>('/claude-accounts'), [host]);
  const [picked, setPicked] = useState<ClaudeAccounts | null>(null);
  const cur = picked ?? data;
  if (!cur?.accounts.length) return null;
  const pick = async (name: string) => {
    try {
      setPicked(await api<ClaudeAccounts>('/claude-accounts/active', { method: 'PUT', body: JSON.stringify({ name }) }));
    } catch (e) {
      Alert.alert('Couldn’t switch', String((e as Error).message ?? e));
    }
  };
  return (
    <Group title="Claude account" footer="New Claude threads run under this account; open ones keep theirs until they restart. Terminal is the claude CLI’s own login.">
      {['', ...cur.accounts].map((name, i) => (
        <GroupRow
          key={name || 'terminal'}
          first={i === 0}
          label={name || 'Terminal'}
          onPress={() => pick(name || 'Terminal')}
          right={cur.active === name ? <Icon name="checkmark" size={15} color={c.accent} /> : null}
        />
      ))}
    </Group>
  );
}
