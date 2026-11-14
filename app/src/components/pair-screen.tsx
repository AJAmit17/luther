import { Fragment, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { Button, Field, RelayMark, SectionHeader, Span, Surface, Text, alert, radius, size, space, useTheme } from '@/design';
import { pair } from '@/lib/hosts';

const STEPS: ReactNode[] = [
  <>Install Luther on your Mac: <Span mono>getluther.pages.dev</Span></>,
  <>Run <Span mono>luther setup</Span> there</>,
  'Scan the code it shows',
  'Name this phone and you’re in',
];

/** The steps, numbered, as rows of one card. */
function Steps() {
  const { color } = useTheme();
  return (
    <Surface style={{ overflow: 'hidden' }}>
      {STEPS.map((step, i) => (
        <Fragment key={i}>
          {i > 0 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: color.line }} />}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: size.row, paddingHorizontal: space.lg, paddingVertical: space.md }}>
            <View style={{ width: 22, height: 22, borderRadius: radius.full, backgroundColor: color.muted, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="caption" weight="medium" color="text">{i + 1}</Text>
            </View>
            <Text variant="callout" style={{ flex: 1 }}>{step}</Text>
          </View>
        </Fragment>
      ))}
    </Surface>
  );
}

// Pair: run `luther pair` on the Mac, then scan its QR (or paste the code under it).
export default function Pair() {
  const { color } = useTheme();
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
      alert('Pairing failed', e.message);
    } finally {
      setBusy(false);
    }
  };

  // iOS's own scanner (VisionKit), not a camera preview of ours: it handles
  // focus, guidance and dismissal, and works inside a modal.
  const scan = async () => {
    if (!(perm?.granted || (await requestPerm()).granted)) {
      alert('Camera access needed', 'Allow camera access in Settings, or paste the code instead.');
      return;
    }
    if (!CameraView.isModernBarcodeScannerAvailable) {
      alert('Scanner unavailable', "This iPhone can't scan here; paste the code instead.");
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
      alert("Couldn't open the scanner", e.message);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: color.bg }}
      contentContainerStyle={{ flexGrow: 1, padding: space.xl, gap: space.xl, paddingBottom: space.xxl + space.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ alignItems: 'center', gap: space.md, paddingTop: space.xl }}>
        <RelayMark size={104} animate />
        <Text variant="title" style={{ textAlign: 'center', marginTop: space.sm }}>Drive your Mac’s agents</Text>
        <Text variant="subhead" color="dim" style={{ textAlign: 'center' }}>Claude Code, Codex, Gemini and more, from your phone, over your tailnet or a tunnel. End-to-end encrypted.</Text>
      </View>

      <Steps />

      <View style={{ gap: space.xs + 2 }}>
        <SectionHeader title="This Phone" />
        <Field value={name} onChangeText={setName} accessibilityLabel="This phone’s name" />
        <Text variant="footnote" style={{ paddingHorizontal: space.lg }}>How it shows on the Mac’s list of devices.</Text>
      </View>

      <Text variant="footnote" color="dim" style={{ paddingHorizontal: space.lg }}>
        Already set up? Run <Span mono>luther pair</Span> for a new code. If your Mac is on your tailnet only, turn on Tailscale on this phone first.
      </Text>

      <View style={{ flex: 1 }} />

      <View style={{ gap: space.sm }}>
        <Button variant="primary" icon="qrcode.viewfinder" label="Scan QR Code" busy={busy} onPress={scan} />
        <Button variant="tertiary" label={showPaste ? 'Hide the Code Field' : 'Paste the Code Instead'} onPress={() => setShowPaste((s) => !s)} />
      </View>

      {showPaste && (
        <View style={{ gap: space.sm + 2 }}>
          <Field mono lines={4} placeholder="The text under the QR code" value={paste} onChangeText={setPaste} autoCapitalize="none" autoCorrect={false} />
          <Button variant="primary" label="Pair" busy={busy} disabled={!paste.trim()} onPress={() => go(paste)} />
        </View>
      )}
    </ScrollView>
  );
}
