import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Chip, EmptyState, HeaderActions, Icon, ListItem, Note, Span, Text, alert, prompt, space, useTheme, type Palette } from '@/design';
import { ListScreen } from '@/features/list-screen';
import { api, del, post, uploadTo } from '@/lib/hosts';
import type { FileContent, FileEntry } from '@/lib/protocol';
import { highlight, langOf, type Kind } from '@/lib/highlight';
import { useLoad } from '@/lib/use-load';
import { Markdown } from '@/components/markdown';

const size = (n: number) => (n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
const IMAGE = /\.(png|jpe?g|gif|webp|heic|bmp|ico|svg)$/i;
const HIGHLIGHT_MAX = 80 << 10; // larger files show plain: thousands of spans are slow

// Project files: a folder lists its entries (add, upload, rename, delete); a
// file shows highlighted, as Markdown, or as a picture (text files open in the editor).
export default function Files() {
  const { color } = useTheme();
  const { cwd, path = '' } = useLocalSearchParams<{ cwd: string; path?: string }>();
  const { data, error, load, pull } = useLoad(
    () => api<FileEntry[] | FileContent>(`/files?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`),
    [cwd, path],
  );
  const root = cwd.split('/').pop() || cwd;
  const title = path ? path.split('/').pop()! : root;
  if (data && !Array.isArray(data)) return <FileView cwd={cwd} path={path} title={title} file={data} />;
  const entries = data as FileEntry[] | null;

  const at = (name: string) => (path ? `${path}/${name}` : name);
  const act = (what: string, p: Promise<unknown>) => p.then(load, (e) => alert(`${what} failed`, e.message));
  const newFile = () => prompt('New File', 'Its name (folders allowed: src/new.ts)', (name) => name.trim() && router.push({ pathname: '/edit', params: { cwd, path: at(name.trim()) } }));
  const newFolder = () => prompt('New Folder', undefined, (name) => name.trim() && act('New Folder', post('/files/mkdir', { cwd, path: at(name.trim()) })));
  const send = async (items: { uri: string; name: string }[]) => {
    for (const it of items) await uploadTo(cwd, at(it.name), it.uri).catch((e) => alert(`Couldn’t upload ${it.name}`, e.message));
    load();
  };
  const photos = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, quality: 1 });
    if (!r.canceled) await send(r.assets.map((a, i) => ({ uri: a.uri, name: a.fileName ?? `photo-${Date.now()}-${i}.${a.uri.split('.').pop()}` })));
  };
  const documents = async () => {
    const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (!r.canceled) await send(r.assets.map((a) => ({ uri: a.uri, name: a.name })));
  };
  const menu = (e: FileEntry) =>
    alert(e.name, undefined, [
      {
        text: 'Rename',
        onPress: () =>
          prompt('Rename', undefined, (to) => to.trim() && to.trim() !== e.name && act('Rename', post('/files/rename', { cwd, from: at(e.name), to: at(to.trim()) })), 'plain-text', e.name),
      },
      {
        text: 'Move to Trash',
        style: 'destructive',
        onPress: () => act('Delete', del(`/files?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(at(e.name))}`)),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const parts = path ? path.split('/') : [];
  const crumbs = path ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      {[root, ...parts].map((p, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          {i > 0 && <Icon name="chevron.right" size={11} />}
          <Chip
            label={p}
            selected={i === parts.length}
            onPress={i === parts.length ? undefined : () => router.push({ pathname: '/files', params: { cwd, path: parts.slice(0, i).join('/') } })}
          />
        </View>
      ))}
    </ScrollView>
  ) : undefined;

  return (
    <>
      <Stack.Screen options={{ title }} />
      <HeaderActions
        actions={[
          {
            icon: 'plus',
            label: 'Add',
            menu: [
              { title: 'New File', icon: 'doc', onPress: newFile },
              { title: 'New Folder', icon: 'folder.badge.plus', onPress: newFolder },
              { title: 'Upload Photos', icon: 'photo.on.rectangle', onPress: photos },
              { title: 'Upload Files', icon: 'doc.on.clipboard', onPress: documents },
            ],
          },
        ]}
      />
      <ListScreen
        data={entries}
        error={error}
        pull={pull}
        keyExtractor={(e) => e.name}
        header={crumbs}
        empty={<EmptyState icon="folder" title="Empty folder" message="Use + to add a file or upload one." />}
        renderItem={({ item: e }) => (
          <ListItem
            icon={e.dir ? 'folder' : IMAGE.test(e.name) ? 'photo' : 'doc'}
            iconColor={e.dir ? color.blue : color.dim}
            title={e.name}
            value={e.dir ? undefined : size(e.size)}
            trailing={e.dir ? <Icon name="chevron.right" size={13} color={color.faint} /> : undefined}
            onPress={() => router.push({ pathname: '/files', params: { cwd, path: at(e.name) } })}
            onLongPress={() => menu(e)}
          />
        )}
      />
    </>
  );
}

const hue = (color: Palette, k: Kind) => (k === 'comment' ? color.faint : k === 'string' ? color.green : k === 'keyword' ? color.accent : k === 'number' ? color.blue : color.text);

function FileView({ cwd, path, title, file }: { cwd: string; path: string; title: string; file: FileContent }) {
  const { color } = useTheme();
  const md = /\.(md|markdown|mdx)$/i.test(path);
  const [source, setSource] = useState(false);
  const [pic, setPic] = useState<string>();
  const [picError, setPicError] = useState('');
  useEffect(() => {
    if (!IMAGE.test(path)) return;
    api<{ type: string; data: string }>(`/files/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`).then((r) => setPic(`data:${r.type};base64,${r.data}`), (e) => setPicError(e.message));
  }, [cwd, path]);
  const spans = useMemo(() => {
    const lang = langOf(path);
    return lang && file.text && file.text.length <= HIGHLIGHT_MAX ? highlight(file.text, lang) : null;
  }, [path, file.text]);

  return (
    <>
      <Stack.Screen options={{ title }} />
      <HeaderActions
        actions={[
          ...(md ? [{ icon: source ? 'doc.richtext' : 'doc.plaintext', label: source ? 'Show Rendered' : 'Show Source', onPress: () => setSource(!source) } as const] : []),
          ...(file.hash ? [{ icon: 'square.and.pencil', label: 'Edit File', onPress: () => router.push({ pathname: '/edit', params: { cwd, path } }) } as const] : []),
        ]}
      />
      <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={md && !source ? { padding: space.lg } : undefined}>
        {IMAGE.test(path) ? (
          pic ? <Image source={{ uri: pic }} style={{ width: '100%', aspectRatio: 1 }} contentFit="contain" /> : <Note tone={picError ? 'danger' : 'neutral'}>{picError || 'Loading the picture…'}</Note>
        ) : file.binary ? (
          <Note>Binary file; not shown.</Note>
        ) : md && !source ? (
          <Markdown text={file.text} />
        ) : (
          <ScrollView horizontal contentContainerStyle={{ padding: space.md }}>
            <Text selectable mono variant="caption" color="text">
              {spans ? spans.map((s, i) => <Span key={i} mono style={{ color: hue(color, s.kind), fontStyle: s.kind === 'comment' ? 'italic' : 'normal' }}>{s.text}</Span>) : file.text}
            </Text>
          </ScrollView>
        )}
        {!!file.truncated && <Note>Showing the first 512 KB.</Note>}
      </ScrollView>
    </>
  );
}
