import { useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { upload } from '@/lib/hosts';
import { Icon, c } from '@/components/ui';

type Item = { key: string; uri: string; name: string; image: boolean; path?: string };

// Photos and files for the next message. Each is uploaded to the Mac as soon as
// it's picked, so sending only names the paths.
export function useAttachments() {
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

  const pick = () =>
    ActionSheetIOS.showActionSheetWithOptions({ options: ['Photo Library', 'Take Photo', 'Files', 'Cancel'], cancelButtonIndex: 3 }, async (i) => {
      if (i === 0) fromImages(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.8 }));
      if (i === 1) {
        if (!(await ImagePicker.requestCameraPermissionsAsync()).granted) return Alert.alert('Camera access is off', 'Turn it on for Luther in Settings.');
        fromImages(await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 }));
      }
      if (i === 2) {
        const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
        if (!r.canceled) add(r.assets.map((a) => ({ uri: a.uri, name: a.name, image: !!a.mimeType?.startsWith('image/') })));
      }
    });

  return {
    items,
    pick,
    remove: (key: string) => setItems((xs) => xs.filter((x) => x.key !== key)),
    clear: () => setItems([]),
    uploading: items.some((x) => !x.path),
    paths: items.flatMap((x) => (x.path ? [x.path] : [])),
  };
}

export function AttachmentChips({ items, onRemove }: { items: Item[]; onRemove: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 8 }}>
      {items.map((x) => (
        <View key={x.key} style={{ width: 64, height: 64, borderRadius: 12, borderCurve: 'continuous', backgroundColor: c.card, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
          {x.image ? (
            <Image source={{ uri: x.uri }} style={{ width: 64, height: 64 }} contentFit="cover" />
          ) : (
            <View style={{ alignItems: 'center', gap: 2, padding: 4 }}>
              <Icon name="doc" size={20} />
              <Text style={{ color: c.dim, fontSize: 9 }} numberOfLines={1}>{x.name}</Text>
            </View>
          )}
          {!x.path && (
            <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0006' }}>
              <ActivityIndicator color="#fff" />
            </View>
          )}
          <Pressable onPress={() => onRemove(x.key)} hitSlop={8} style={{ position: 'absolute', top: 3, right: 3 }}>
            <Icon name="xmark.circle.fill" size={18} color="#fffd" />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
