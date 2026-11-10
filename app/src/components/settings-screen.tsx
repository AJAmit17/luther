import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { RouteMark, isTailnet } from '@/features/route-mark';
import { api, currentHost, del, keyFor, removeHost, resolve, routeInUse, upsertHost, type Host } from '@/lib/hosts';
import type { Device } from '@/lib/protocol';
import { Group, LargeTitle, ListItem, Note, Pill, Surface, Text, TextInput, Tile, alert, space, useTheme } from '@/design';
import { since } from '@/lib/format';
import { AppearancePicker } from '@/components/appearance-picker';
import { PermissionsSection } from '@/components/permissions-section';

// The current Mac: usage, routes (in order), Cloudflare Access token, paired devices.
export default function Settings() {
  const { color } = useTheme();
  const input = { paddingHorizontal: space.lg, paddingVertical: space.md + 1 } as const;
  const [h, setH] = useState<Host | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const loadDevices = () => api<Device[]>('/devices').then(setDevices, (e) => setError(e.message));
  useFocusEffect(
    useCallback(() => {
      currentHost().then(setH);
      void loadDevices();
    }, []),
  );

  const save = async (next: Host) => {
    setH(next);
    await upsertHost(next);
  };
  const test = async () => {
    if (!h) return;
    setStatus('Testing…');
    const t = Date.now();
    try {
      const u = await resolve(h, true);
      setStatus(`Reached ${u.replace(/^https:\/\//, '')} in ${Date.now() - t} ms`);
    } catch (e: any) {
      setStatus(e.message);
    }
  };
  const revoke = (d: Device) =>
    h &&
    alert(`Revoke ${d.name}?`, d.id === h.id ? 'This phone loses access until you pair it again.' : 'That device loses access right away.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: () =>
          del('/devices/' + d.id).then(async () => {
            if (d.id === h.id) {
              await removeHost(h.id);
              router.replace('/');
            } else void loadDevices();
          }, (e) => alert('Error', e.message)),
      },
    ]);
  const forget = () =>
    h &&
    alert(`Forget ${h.name}?`, 'Removes it from this phone. Revoke this device too if you won’t pair again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: async () => { await removeHost(h.id); router.replace('/'); } },
    ]);

  const using = h ? routeInUse(h) : null;
  const encrypted = !!h && !!keyFor(h);
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxl + space.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Settings' }} />
      <LargeTitle>Settings</LargeTitle>
      {!h ? (
        <>
          <AppearancePicker />
          <PermissionsSection />
          <Note>No Mac paired.</Note>
        </>
      ) : (
        <>
          <Surface style={{ padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md + 2 }}>
            <Tile icon="desktopcomputer" color={color.text} size={48} />
            <View style={{ flex: 1, gap: space.xs }}>
              <Text variant="title3" numberOfLines={1}>{h.name}</Text>
              {!encrypted && <Text variant="footnote">Not encrypted. Pair again to encrypt.</Text>}
            </View>
            {encrypted ? <Pill label="Encrypted" tone="success" icon="lock.fill" /> : <Pill label="Not encrypted" tone="warning" icon="lock.open" />}
          </Surface>

          <AppearancePicker />
          <PermissionsSection />

          <Group title="Connection" footer={status || 'Tried in this order; tap one to try it first.'}>
            {h.routes.map((u, i) => (
              <ListItem
                key={u}
                leading={<RouteMark url={u} />}
                title={u.replace(/^https:\/\//, '')}
                subtitle={`${isTailnet(u) ? 'Tailnet' : 'Cloudflare tunnel'}${u.includes('/r/') ? ' · relayed by another machine' : ''}`}
                trailing={u === using ? <Pill label="In use" tone="success" /> : i > 0 ? <Text variant="footnote" color="accent">Prefer</Text> : <View />}
                onPress={i > 0 ? () => save({ ...h, routes: [u, ...h.routes.filter((x) => x !== u)] }) : undefined}
              />
            ))}
            <ListItem icon="bolt.horizontal" iconColor={color.accent} title="Test Connection" onPress={test} trailing={<View />} />
          </Group>

          <Group title="Cloudflare Access" footer="Only if your tunnel sits behind Cloudflare Access with a service token. Stored in this phone’s secure storage.">
              <TextInput mono style={input} placeholder="CF-Access-Client-Id" autoCapitalize="none" autoCorrect={false}
                value={h.cfId ?? ''} onChangeText={(v) => setH({ ...h, cfId: v.trim() })} onEndEditing={() => save(h)} />
              <View style={{ height: 1, backgroundColor: color.line }} />
              <TextInput mono style={input} placeholder="CF-Access-Client-Secret" autoCapitalize="none" autoCorrect={false} secureTextEntry
                value={h.cfSecret ?? ''} onChangeText={(v) => setH({ ...h, cfSecret: v.trim() })} onEndEditing={() => save(h)} />
          </Group>

          <Group title="Paired Devices" footer={error || 'Any paired device can revoke another, so a lost phone can be cut off from this one.'}>
            {devices.map((d) => (
              <ListItem
                key={d.id}
                leading={<Tile icon="iphone" color={d.id === h.id ? color.accent : color.text} size={32} />}
                title={d.name + (d.id === h.id ? ' (this phone)' : '')}
                subtitle={[d.encrypted ? 'Encrypted' : 'Not encrypted', `paired ${since(d.created)}`, `seen ${since(d.lastSeen)}`].join(' · ')}
                trailing={<Text variant="footnote" color="red">Revoke</Text>}
                onPress={() => revoke(d)}
              />
            ))}
            {!devices.length && <ListItem title="Loading…" />}
          </Group>

          <Group title="This Mac" footer="Luther's version, each agent and its process, and the server's log.">
            <ListItem icon="heart.text.square" iconColor={color.accent} title="Health" onPress={() => router.push('/health')} />
            <ListItem icon="doc.plaintext" iconColor={color.dim} title="Server Log" onPress={() => router.push('/log')} />
          </Group>

          <Group>
            <ListItem icon="plus.circle" iconColor={color.accent} title="Pair Another Mac" onPress={() => router.push('/pair')} />
            <ListItem icon="trash" destructive title="Forget This Mac" onPress={forget} />
          </Group>
        </>
      )}
    </ScrollView>
  );
}
