import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { currentHost, post, resolve, api } from '@/lib/hosts';
import type { Port } from '@/lib/protocol';
import { Icon, Note, Row, c, home, useLoad, listStyle, useHex } from '@/components/ui';

// Dev servers on the Mac (anything of yours listening on a port), opened in
// Safari on the phone through Luther's route: tap localhost:3000, see the app.
export default function Preview() {
  useHex();
  const { cwd } = useLocalSearchParams<{ cwd?: string }>();
  const { data, error, pull } = useLoad(() => api<Port[]>('/ports'), []);
  const [opening, setOpening] = useState<number | null>(null);
  // This project's servers first.
  const ports = [...(data ?? [])].sort((a, b) => Number(!!cwd && b.cwd?.startsWith(cwd)) - Number(!!cwd && a.cwd?.startsWith(cwd)));

  const open = async (p: Port) => {
    setOpening(p.port);
    try {
      const h = await currentHost();
      if (!h) throw new Error('No Mac paired');
      const { path } = await post<{ path: string }>('/previews', { port: p.port });
      await WebBrowser.openBrowserAsync((await resolve(h)) + path, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
    } catch (e: any) {
      Alert.alert(`Couldn't open port ${p.port}`, e.message);
    } finally {
      setOpening(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Preview' }} />
      <FlatList
        contentContainerStyle={listStyle}
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        data={ports}
        keyExtractor={(p) => String(p.port)}
        refreshControl={<RefreshControl {...pull} />}
        ListHeaderComponent={
          error ? <Note error>{error}</Note> : <Note>Pick your dev server. It opens through Luther; paths Luther uses itself (/files, /events…) won&apos;t reach the app.</Note>
        }
        ListEmptyComponent={data ? <Note>Nothing is listening. Start your dev server on the Mac (or ask the agent to), then pull to refresh.</Note> : undefined}
        renderItem={({ item: p }) => (
          <Row
            icon={<Icon name="globe" size={20} color={c.blue} />}
            title={`localhost:${p.port}`}
            sub={`${p.command}${p.cwd ? ' · ' + home(p.cwd) : ''}`}
            right={opening === p.port ? <ActivityIndicator /> : <Icon name="arrow.up.right.square" size={16} color={c.faint} />}
            onPress={() => open(p)}
          />
        )}
      />
    </>
  );
}
