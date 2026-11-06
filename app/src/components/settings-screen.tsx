import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { api, currentHost, del, keyFor, removeHost, resolve, routeInUse, upsertHost, type Host } from '@/lib/hosts';
import type { Device } from '@/lib/protocol';
import { Group, GroupRow, Icon, IconTile, Note, Pill, ago, c, card, mono, type, useHex } from '@/components/ui';
import { AppearancePicker } from '@/components/appearance-picker';
import { PermissionsSection } from '@/components/permissions-section';

// The current Mac: usage, routes (in order), Cloudflare Access token, paired devices.
export default function Settings() {
  useHex();
  const input = { ...type.subhead, fontFamily: mono, paddingHorizontal: 16, paddingVertical: 13 } as const;
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
    Alert.alert(`Revoke ${d.name}?`, d.id === h.id ? 'This phone loses access until you pair it again.' : 'That device loses access right away.', [
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
          }, (e) => Alert.alert('Error', e.message)),
      },
    ]);
  const forget = () =>
    h &&
    Alert.alert(`Forget ${h.name}?`, 'Removes it from this phone. Revoke this device too if you won’t pair again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: async () => { await removeHost(h.id); router.replace('/'); } },
    ]);

  const using = h ? routeInUse(h) : null;
  const encrypted = !!h && !!keyFor(h);
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 22, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Settings' }} />
      {!h ? (
        <>
          <AppearancePicker />
          <PermissionsSection />
          <Note>No Mac paired.</Note>
        </>
      ) : (
        <>
          <View style={[card, { padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
            <IconTile name="desktopcomputer" color={c.accent} size={48} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={type.title3} numberOfLines={1}>{h.name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Icon name={encrypted ? 'lock.fill' : 'lock.open'} size={11} color={encrypted ? c.green : c.warn} />
                <Text style={type.footnote}>{encrypted ? 'End-to-end encrypted' : 'Not encrypted: pair again to encrypt'}</Text>
              </View>
            </View>
          </View>

          <AppearancePicker />
          <PermissionsSection />

          <Group title="Connection" footer={status || 'Tried in this order; tap one to try it first.'}>
            {h.routes.map((u, i) => (
              <GroupRow
                key={u}
                first={i === 0}
                icon={u.includes('.ts.net') ? 'network' : 'cloud'}
                iconColor={c.blue}
                label={u.replace(/^https:\/\//, '')}
                sub={`${u.includes('.ts.net') ? 'Tailnet' : 'Cloudflare tunnel'}${u.includes('/r/') ? ' · relayed by another machine' : ''}`}
                right={u === using ? <Pill label="In use" tone="green" /> : i > 0 ? <Text style={[type.footnote, { color: c.accent }]}>Prefer</Text> : <View />}
                onPress={i > 0 ? () => save({ ...h, routes: [u, ...h.routes.filter((x) => x !== u)] }) : undefined}
              />
            ))}
            <GroupRow icon="bolt.horizontal" iconColor={c.accent} label="Test connection" onPress={test} right={<View />} />
          </Group>

          <Group title="Cloudflare Access" footer="Only if your tunnel sits behind Cloudflare Access with a service token. Stored in this phone’s secure storage.">
            <TextInput style={input} placeholder="CF-Access-Client-Id" placeholderTextColor={c.faint as string} autoCapitalize="none" autoCorrect={false}
              value={h.cfId ?? ''} onChangeText={(v) => setH({ ...h, cfId: v.trim() })} onEndEditing={() => save(h)} />
            <View style={{ height: 1, backgroundColor: c.line }} />
            <TextInput style={input} placeholder="CF-Access-Client-Secret" placeholderTextColor={c.faint as string} autoCapitalize="none" autoCorrect={false} secureTextEntry
              value={h.cfSecret ?? ''} onChangeText={(v) => setH({ ...h, cfSecret: v.trim() })} onEndEditing={() => save(h)} />
          </Group>

          <Group title="Paired devices" footer={error || 'Any paired device can revoke another, so a lost phone can be cut off from this one.'}>
            {devices.map((d, i) => (
              <GroupRow
                key={d.id}
                first={i === 0}
                icon={d.encrypted ? 'lock.iphone' : 'iphone'}
                iconColor={d.encrypted ? c.green : c.dim}
                label={d.name + (d.id === h.id ? ' (this phone)' : '')}
                sub={`Paired ${ago(d.created)} ago · seen ${ago(d.lastSeen)} ago`}
                right={<Text style={[type.footnote, { color: c.red }]}>Revoke</Text>}
                onPress={() => revoke(d)}
              />
            ))}
            {!devices.length && <GroupRow first label="Loading…" />}
          </Group>

          <Group>
            <GroupRow first icon="plus.circle" iconColor={c.accent} label="Pair another Mac" onPress={() => router.push('/pair')} />
            <GroupRow icon="trash" destructive label="Forget this Mac" onPress={forget} />
          </Group>
        </>
      )}
    </ScrollView>
  );
}
