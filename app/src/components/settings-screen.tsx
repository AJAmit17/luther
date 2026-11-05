import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { api, currentHost, del, removeHost, resolve, routeInUse, upsertHost, type Host } from '@/lib/hosts';
import type { Device } from '@/lib/protocol';
import { Badge, Button, Icon, Note, Row, Section, ago, c, mono } from '@/components/ui';
import { UsageSection } from '@/components/usage-section';

const input = { color: c.text, backgroundColor: c.card, borderRadius: 12, borderCurve: 'continuous', padding: 12, fontFamily: mono, fontSize: 13 } as const;

// The current Mac: routes (in order), Cloudflare Access token, paired devices.
export default function Settings() {
  const [h, setH] = useState<Host | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const loadDevices = () => api<Device[]>('/devices').then(setDevices, (e) => setError(e.message));
  useEffect(() => {
    currentHost().then(setH);
    loadDevices();
  }, []);
  if (!h) return null;

  const save = async (next: Host) => {
    setH(next);
    await upsertHost(next);
  };
  const test = async () => {
    setStatus('Testing…');
    const t = Date.now();
    try {
      const u = await resolve(h, true);
      setStatus(`Connected via ${u} in ${Date.now() - t} ms`);
    } catch (e: any) {
      setStatus(e.message);
    }
  };
  const revoke = (d: Device) =>
    Alert.alert(`Revoke ${d.name}?`, d.id === h.id ? 'This phone will lose access until you pair it again.' : 'That device loses access immediately.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: () =>
          del('/devices/' + d.id).then(async () => {
            if (d.id === h.id) {
              await removeHost(h.id);
              router.dismissAll();
              router.replace('/');
            } else loadDevices();
          }, (e) => Alert.alert('Error', e.message)),
      },
    ]);
  const forget = () =>
    Alert.alert(`Forget ${h.name}?`, 'Removes it from this phone. Revoke the device too if you will not pair again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: async () => { await removeHost(h.id); router.dismissAll(); router.replace('/'); } },
    ]);

  const using = routeInUse(h);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg as any }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      <Text style={{ color: c.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 16, paddingTop: 12 }}>{h.name}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingTop: 4 }}>
        <Icon name={h.secret ? 'lock.fill' : 'lock.open'} size={13} color={h.secret ? c.green : c.accent} />
        <Text style={{ color: c.dim, fontSize: 13, flex: 1 }}>
          {h.secret ? 'End-to-end encrypted: the tunnel only relays ciphertext.' : 'Not end-to-end encrypted (paired with an older version). Pair again to encrypt; the tunnel refuses nothing until then.'}
        </Text>
      </View>

      <UsageSection />

      <Section title="Routes (tried in order)" />
      {h.routes.map((u, i) => (
        <Row
          key={u}
          icon={<Icon name={u.includes('.ts.net') ? 'network' : 'cloud'} color={c.blue} />}
          title={u.replace(/^https:\/\//, '')}
          sub={u.includes('.ts.net') ? 'Tailnet' : 'Cloudflare tunnel'}
          right={u === using ? <Badge label="in use" color={c.green} /> : i > 0 ? <Text style={{ color: c.accent }}>Prefer</Text> : undefined}
          onPress={() => i > 0 && save({ ...h, routes: [u, ...h.routes.filter((x) => x !== u)] })}
        />
      ))}
      <View style={{ padding: 16, gap: 8 }}>
        <Button icon="bolt.horizontal" label="Test connection" onPress={test} />
        {!!status && <Note>{status}</Note>}
      </View>

      <Section title="Cloudflare Access (tunnel only)" />
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        <TextInput style={input} placeholder="CF-Access-Client-Id" placeholderTextColor={c.dim} autoCapitalize="none" autoCorrect={false}
          value={h.cfId ?? ''} onChangeText={(v) => setH({ ...h, cfId: v.trim() })} onEndEditing={() => save(h)} />
        <TextInput style={input} placeholder="CF-Access-Client-Secret" placeholderTextColor={c.dim} autoCapitalize="none" autoCorrect={false} secureTextEntry
          value={h.cfSecret ?? ''} onChangeText={(v) => setH({ ...h, cfSecret: v.trim() })} onEndEditing={() => save(h)} />
        <Text style={{ color: c.dim, fontSize: 12 }}>Only if your tunnel sits behind Cloudflare Access with a service token. Stored in the iOS keychain.</Text>
      </View>

      <Section title="Paired devices" />
      {!!error && <Note error>{error}</Note>}
      {devices.map((d) => (
        <Row
          key={d.id}
          icon={<Icon name={d.encrypted ? 'lock.iphone' : 'iphone'} color={d.encrypted ? c.green : c.dim} />}
          title={d.name + (d.id === h.id ? ' (this phone)' : '')}
          sub={`paired ${ago(d.created)} ago · seen ${ago(d.lastSeen)} ago`}
          right={<Text style={{ color: c.red }}>Revoke</Text>}
          onPress={() => revoke(d)}
        />
      ))}

      <View style={{ padding: 16, gap: 10, paddingBottom: 40 }}>
        <Button icon="plus" label="Pair another Mac" onPress={() => router.push('/pair')} />
        <Button kind="danger" label="Forget this Mac" onPress={forget} />
      </View>
    </ScrollView>
  );
}
