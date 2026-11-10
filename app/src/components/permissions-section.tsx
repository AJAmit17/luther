import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Chip, Group, ListItem, Pill, useTheme, type IconName } from '@/design';

type Status = { granted: boolean; canAskAgain: boolean };
type Perm = { id: string; label: string; sub: string; icon: IconName; get: () => Promise<Status>; ask: () => Promise<Status> };

// What Luther asks the phone for, and why. Photos and files go through the
// system pickers, which need no permission.
const PERMS: Perm[] = [
  { id: 'camera', label: 'Camera', sub: 'Take a photo for a message; scan a Mac’s pairing code', icon: 'camera', get: ImagePicker.getCameraPermissionsAsync, ask: ImagePicker.requestCameraPermissionsAsync },
  {
    id: 'mic',
    label: 'Microphone and Speech',
    sub: 'Hold the mic to dictate a message',
    icon: 'mic',
    get: () => ExpoSpeechRecognitionModule.getPermissionsAsync(),
    ask: () => ExpoSpeechRecognitionModule.requestPermissionsAsync(),
  },
  { id: 'notifications', label: 'Notifications', sub: 'When an agent finishes or needs your answer', icon: 'bell', get: Notifications.getPermissionsAsync, ask: () => Notifications.requestPermissionsAsync() },
];

/** Settings → Permissions: each one's state, with Allow (or Open Settings once
 *  the system won't ask again). Re-read whenever the app comes back. */
export function PermissionsSection() {
  const { color } = useTheme();
  const [state, setState] = useState<Record<string, Status>>({});
  const read = useCallback(() => {
    for (const p of PERMS) p.get().then((s) => setState((x) => ({ ...x, [p.id]: { granted: s.granted, canAskAgain: s.canAskAgain } })), () => {});
  }, []);
  useEffect(() => {
    read();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && read());
    return () => sub.remove();
  }, [read]);

  return (
    <Group title="Permissions" footer="Photos and files are picked with the system pickers, which need no permission.">
      {PERMS.map((p) => {
        const s = state[p.id];
        const right = !s ? undefined : s.granted ? (
          <Pill label="Allowed" tone="success" />
        ) : s.canAskAgain ? (
          <Chip label="Allow" tone="accent" onPress={() => p.ask().then(read, read)} />
        ) : (
          <Chip label="Open Settings" onPress={() => void Linking.openSettings()} />
        );
        return <ListItem key={p.id} icon={p.icon} iconColor={color.accent} title={p.label} subtitle={p.sub} subtitleLines={2} trailing={right} />;
      })}
    </Group>
  );
}
