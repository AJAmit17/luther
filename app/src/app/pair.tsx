import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { pair } from '@/lib/hosts';
import { Button, Note, c, mono } from '@/lib/ui';

// Pair: run `luther pair` on the Mac, then scan its QR (or paste the JSON under it).
export default function Pair() {
  const [perm, requestPerm] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [paste, setPaste] = useState('');
  const [name, setName] = useState(Device.deviceName ?? 'iPhone');
  const [busy, setBusy] = useState(false);

  const go = async (text: string) => {
    if (busy) return;
    setScanning(false);
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

  if (scanning) {
    return (
      <View style={{ flex: 1 }}>
        <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => scanning && go(data)} />
        <View style={{ padding: 16 }}><Button label="Cancel" onPress={() => setScanning(false)} /></View>
      </View>
    );
  }
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: c.text, fontSize: 15, lineHeight: 21 }}>
        On your Mac, run <Text style={{ fontFamily: mono }}>luther pair</Text>. It shows a QR code that works once, for 10 minutes.
      </Text>
      <Button kind="accent" icon="qrcode.viewfinder" label="Scan QR code" disabled={busy}
        onPress={async () => ((perm?.granted || (await requestPerm()).granted) ? setScanning(true) : Alert.alert('Camera access needed', 'Allow camera access in Settings, or paste the code instead.'))} />
      <TextInput
        style={{ color: c.text, backgroundColor: c.card, borderRadius: 12, borderCurve: 'continuous', padding: 12, fontFamily: mono, fontSize: 12, minHeight: 80 }}
        placeholder="…or paste the JSON shown under the QR"
        placeholderTextColor={c.dim}
        value={paste}
        onChangeText={setPaste}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button label="Pair with pasted code" disabled={!paste.trim() || busy} onPress={() => go(paste)} />
      <Text style={{ color: c.dim, fontSize: 13 }}>Name for this phone on the Mac</Text>
      <TextInput style={{ color: c.text, backgroundColor: c.card, borderRadius: 12, borderCurve: 'continuous', padding: 12, fontSize: 15 }} value={name} onChangeText={setName} />
      {busy && <ActivityIndicator />}
      <Note>Pairing goes over your tailnet or tunnel. Turn Tailscale on first if your Mac uses it.</Note>
    </ScrollView>
  );
}
