import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { upload } from '@/lib/hosts';
import { Icon, c, type, useHex } from '@/components/ui';

type Item = { key: string; uri: string; name: string; image: boolean; path?: string };

// Android may kill Luther while the camera or photo picker is open; it then
// starts again on Home and the photo is lost. So the conversation is noted
// before the picker opens, and on the next launch restorePick() takes the
// photo back (the picker keeps it) and reopens that conversation with it.
const PICKING = 'luther.picking';
type Where = { id: string; cwd?: string };
let restored: { id: string; assets: ImagePicker.ImagePickerAsset[] } | null = null;

/** At launch (Android): finish a pick the system interrupted. */
export async function restorePick() {
  if (process.env.EXPO_OS !== 'android') return;
  let where: Where | null = null;
  try {
    where = JSON.parse(SecureStore.getItem(PICKING) ?? 'null');
    SecureStore.deleteItemAsync(PICKING).catch(() => {});
  } catch {
    return;
  }
  if (!where) return;
  const r = await ImagePicker.getPendingResultAsync().catch(() => null);
  if (!r || !('assets' in r) || r.canceled || !r.assets?.length) return;
  restored = { id: where.id, assets: r.assets };
  router.push({ pathname: '/thread/[id]', params: { id: where.id, cwd: where.cwd ?? '' } });
}

// Photos and files for the next message. Each is uploaded to the Mac as soon as
// it's picked, so sending only names the paths. `where` is the conversation they're for.
export function useAttachments(where?: Where) {
  const [items, setItems] = useState<Item[]>([]);

  const add = (picked: Omit<Item, 'key'>[]) => {
    const next = picked.map((p) => ({ ...p, key: Math.random().toString(36).slice(2) }));
    setItems((xs) => [...xs, ...next]);
    for (const it of next) {
      upload(it.uri, it.name).then(
        (path) => setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, path } : x))),
        (e) => {
          setItems((xs) => xs.filter((x) => x.key !== it.key));
          Alert.alert(`Couldn't attach ${it.name}`, e.message);
        },
      );
    }
  };

  const fromImages = (r: ImagePicker.ImagePickerResult) =>
    !r.canceled && add(r.assets.map((a) => ({ uri: a.uri, name: a.fileName ?? `photo-${Date.now()}.jpg`, image: true })));

  // A photo the system interrupted (restorePick) joins this conversation's next message.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (restored && where && restored.id === where.id) {
      fromImages({ canceled: false, assets: restored.assets });
      restored = null;
    }
  }, [where?.id]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  // Note where we are while the picker is open (see restorePick).
  const picking = async (open: () => Promise<ImagePicker.ImagePickerResult>) => {
    if (where) SecureStore.setItem(PICKING, JSON.stringify(where));
    try {
      fromImages(await open());
    } finally {
      SecureStore.deleteItemAsync(PICKING).catch(() => {});
    }
  };

  const pick = async (from: 'photos' | 'camera' | 'files') => {
    if (from === 'photos') await picking(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.8 }));
    if (from === 'camera') {
      if (!(await ImagePicker.requestCameraPermissionsAsync()).granted) return Alert.alert('Camera access is off', 'Turn it on for Luther in Settings.');
      await picking(() => ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 }));
    }
    if (from === 'files') {
      const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (!r.canceled) add(r.assets.map((a) => ({ uri: a.uri, name: a.name, image: !!a.mimeType?.startsWith('image/') })));
    }
  };

  return {
    items,
    pick,
    remove: (key: string) => setItems((xs) => xs.filter((x) => x.key !== key)),
    clear: () => setItems([]),
    uploading: items.some((x) => !x.path),
    paths: items.flatMap((x) => (x.path ? [x.path] : [])),
  };
}

export function AttachmentStrip({ items, onRemove }: { items: Item[]; onRemove: (key: string) => void }) {
  useHex();
  if (!items.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
      {items.map((x) => (
        <View key={x.key} style={{ width: 56, height: 56, borderRadius: 12, borderCurve: 'continuous', backgroundColor: c.muted, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
          {x.image ? (
            <Image source={{ uri: x.uri }} style={{ width: 56, height: 56 }} contentFit="cover" />
          ) : (
            <View style={{ alignItems: 'center', gap: 2, padding: 4 }}>
              <Icon name="doc" size={18} />
              <Text style={[type.caption2, { fontSize: 9 }]} numberOfLines={1}>{x.name}</Text>
            </View>
          )}
          {!x.path && (
            <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0007' }}>
              <ActivityIndicator color="#fff" />
            </View>
          )}
          <Pressable onPress={() => onRemove(x.key)} hitSlop={8} accessibilityLabel={`Remove ${x.name}`} style={{ position: 'absolute', top: 3, right: 3 }}>
            <Icon name="xmark.circle.fill" size={17} color="#FFFFFFE6" />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
