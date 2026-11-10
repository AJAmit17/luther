import { useState } from 'react';
import { Group, ListItem, alert } from '@/design';
import { useLoad } from '@/lib/use-load';
import { api, currentHostIdSync } from '@/lib/hosts';
import type { ClaudeAccounts } from '@/lib/protocol';

// Which Claude account new Claude threads run under: the CLI's own login (Terminal) or one added
// with `luther claude-account add`. Shown only once there is a second; tokens never reach the phone.
export function ClaudeAccountSection() {
  const host = currentHostIdSync();
  const { data } = useLoad(() => api<ClaudeAccounts>('/claude-accounts'), [host]);
  const [picked, setPicked] = useState<ClaudeAccounts | null>(null);
  const cur = picked ?? data;
  if (!cur?.accounts.length) return null;
  const pick = async (name: string) => {
    try {
      setPicked(await api<ClaudeAccounts>('/claude-accounts/active', { method: 'PUT', body: JSON.stringify({ name }) }));
    } catch (e) {
      alert('Couldn’t switch', String((e as Error).message ?? e));
    }
  };
  return (
    <Group title="Claude Account" footer="New Claude threads run under this account; open ones keep theirs until they restart. Terminal is the claude CLI’s own login.">
      {['', ...cur.accounts].map((name) => (
        <ListItem key={name || 'terminal'} title={name || 'Terminal'} selected={cur.active === name} onPress={() => pick(name || 'Terminal')} />
      ))}
    </Group>
  );
}
