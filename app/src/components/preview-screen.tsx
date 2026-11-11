import { useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { EmptyState, Icon, ListItem, Note, Spinner, Tile, alert, useTheme } from '@/design';
import { ListScreen } from '@/features/list-screen';
import { post, api } from '@/lib/hosts';
import { openOnMac } from '@/lib/artifacts';
import type { Port } from '@/lib/protocol';
import { home } from '@/lib/format';
import { useLoad } from '@/lib/use-load';

// Dev servers on the Mac (anything of yours listening on a port), opened in
// Safari on the phone through Luther's route: tap localhost:3000, see the app.
export default function Preview() {
  const { color } = useTheme();
  const { cwd } = useLocalSearchParams<{ cwd?: string }>();
  const { data, error, pull } = useLoad(() => api<Port[]>('/ports'), []);
  const [opening, setOpening] = useState<number | null>(null);
  // This project's servers first.
  const ports = data && [...data].sort((a, b) => Number(!!cwd && b.cwd?.startsWith(cwd)) - Number(!!cwd && a.cwd?.startsWith(cwd)));

  const open = async (p: Port) => {
    setOpening(p.port);
    try {
      const { path } = await post<{ path: string }>('/previews', { port: p.port });
      await openOnMac(path);
    } catch (e) {
      alert(`Couldn't open port ${p.port}`, e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Preview' }} />
      <ListScreen
        data={ports}
        error={error}
        pull={pull}
        keyExtractor={(p) => String(p.port)}
        header={error ? undefined : <Note>Pick your dev server. It opens through Luther; paths Luther uses itself (/files, /events…) won&apos;t reach the app.</Note>}
        empty={<EmptyState icon="globe" title="Nothing is listening" message="Start your dev server on the Mac (or ask the agent to), then pull to refresh." />}
        renderItem={({ item: p }) => (
          <ListItem
            leading={<Tile icon="globe" color={color.blue} />}
            title={`localhost:${p.port}`}
            subtitle={`${p.command}${p.cwd ? ' · ' + home(p.cwd) : ''}`}
            trailing={opening === p.port ? <Spinner /> : <Icon name="arrow.up.right.square" size={16} color={color.faint} />}
            onPress={() => open(p)}
          />
        )}
      />
    </>
  );
}
