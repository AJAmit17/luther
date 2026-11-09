import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { pair } from '@/lib/hosts';
import { Button, Group, IconTile, c, card, mono, type, useHex } from '@/components/ui';

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => {
  useHex();
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.footnote, { color: c.text, fontWeight: '600' }]}>{n}</Text>
      </View>
      <Text style={[type.subhead, { flex: 1, paddingTop: 2 }]}>{children}</Text>
    </View>
  );
};

// Pair: run `luther pair` on the Mac, then scan its QR (or paste the code under it).
export default function Pair() {
  useHex();
  const [perm, requestPerm] = useCameraPermissions();
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [name, setName] = useState(Device.deviceName ?? 'iPhone');
  const [busy, setBusy] = useState(false);

  const go = async (text: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await pair(text, name);
      router.dismissAll();
      router.replace('/');
    } catch (e: any) {
      Alert.alert('Pairing failed', e.message);
    } finally {
      setBusy(false);
    }
  };

  // iOS's own scanner (VisionKit), not a camera preview of ours: it handles
  // focus, guidance and dismissal, and works inside a modal.
  const scan = async () => {
    if (!(perm?.granted || (await requestPerm()).granted)) {
      Alert.alert('Camera access needed', 'Allow camera access in Settings, or paste the code instead.');
      return;
    }
    if (!CameraView.isModernBarcodeScannerAvailable) {
      Alert.alert('Scanner unavailable', "This iPhone can't scan here; paste the code instead.");
      return;
    }
    const sub = CameraView.onModernBarcodeScanned(({ data }) => {
      sub.remove();
      void CameraView.dismissScanner();
      void go(data);
    });
    try {
      await CameraView.launchScanner({ barcodeTypes: ['qr'], isGuidanceEnabled: true, isHighlightingEnabled: true });
    } catch (e: any) {
      sub.remove();
      Alert.alert("Couldn't open the scanner", e.message);
    }
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, gap: 22, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <View style={{ alignItems: 'center', gap: 10, paddingTop: 8 }}>
        <IconTile name="desktopcomputer" color={c.accent} size={72} />
        <Text style={[type.title2, { textAlign: 'center' }]}>Drive your Mac’s agents</Text>
        <Text style={[type.subhead, { color: c.dim, textAlign: 'center' }]}>Claude Code, Codex and others keep running on your Mac. This phone steers them over your tailnet or tunnel, end-to-end encrypted.</Text>
      </View>

      <View style={[card, { padding: 16, gap: 14 }]}>
        <Step n={1}>Turn on Tailscale here if your Mac uses it.</Step>
        <Step n={2}>
          On the Mac, run <Text style={{ fontFamily: mono, color: c.text }}>luther pair</Text>. It shows a QR code that works once, for 10 minutes.
        </Step>
        <Step n={3}>Scan it.</Step>
      </View>

      <View style={{ gap: 10 }}>
        <Button kind="accent" icon="qrcode.viewfinder" label="Scan QR code" busy={busy} onPress={scan} />
        <Button icon="doc.on.clipboard" label={showPaste ? 'Hide' : 'Paste the code instead'} onPress={() => setShowPaste((s) => !s)} />
      </View>

      {showPaste && (
        <View style={{ gap: 10 }}>
          <TextInput
            style={[card, { ...type.footnote, color: c.text, fontFamily: mono, padding: 12, minHeight: 96 }]}
            placeholder="The text under the QR code"
            placeholderTextColor={c.faint as string}
            value={paste}
            onChangeText={setPaste}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button kind="accent" label="Pair" busy={busy} disabled={!paste.trim()} onPress={() => go(paste)} />
        </View>
      )}

      <Group title="This phone" footer="How it shows on the Mac's list of devices.">
        <TextInput style={{ ...type.body, paddingHorizontal: 16, paddingVertical: 13 }} value={name} onChangeText={setName} />
      </Group>
    </ScrollView>
  );
}
