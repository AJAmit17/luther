import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, RefreshControl, ScrollView, Text } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { api, del, post, uploadTo } from '@/lib/hosts';
import type { FileContent, FileEntry } from '@/lib/protocol';
import { highlight, langOf, type Kind } from '@/lib/highlight';
import { Markdown } from '@/components/markdown';
import { Icon, Note, Row, c, mono, useLoad, listStyle, useHex } from '@/components/ui';
import { tb } from '@/components/toolbar-icon';

const size = (n: number) => (n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
const IMAGE = /\.(png|jpe?g|gif|webp|heic|bmp|ico|svg)$/i;
const HIGHLIGHT_MAX = 80 << 10; // larger files show plain: thousands of spans are slow

// Project files: a folder lists its entries (add, upload, rename, delete); a
// file shows highlighted, as Markdown, or as a picture (text files open in the editor).
export default function Files() {
  useHex();
  const { cwd, path = '' } = useLocalSearchParams<{ cwd: string; path?: string }>();
  const { data, error, load, pull } = useLoad(
    () => api<FileEntry[] | FileContent>(`/files?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`),
    [cwd, path],
  );
  const title = path ? path.split('/').pop() : cwd.split('/').pop();
  if (data && !Array.isArray(data)) return <FileView cwd={cwd} path={path} title={title!} file={data} />;

  const at = (name: string) => (path ? `${path}/${name}` : name);
  const act = (what: string, p: Promise<unknown>) => p.then(load, (e) => Alert.alert(`${what} failed`, e.message));
  const newFile = () => Alert.prompt('New file', 'Its name (folders allowed: src/new.ts)', (name) => name.trim() && router.push({ pathname: '/edit', params: { cwd, path: at(name.trim()) } }));
  const newFolder = () => Alert.prompt('New folder', undefined, (name) => name.trim() && act('New folder', post('/files/mkdir', { cwd, path: at(name.trim()) })));
  const send = async (items: { uri: string; name: string }[]) => {
    for (const it of items) await uploadTo(cwd, at(it.name), it.uri).catch((e) => Alert.alert(`Couldn’t upload ${it.name}`, e.message));
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
    Alert.alert(e.name, undefined, [
      {
        text: 'Rename',
        onPress: () =>
          Alert.prompt('Rename', undefined, (to) => to.trim() && to.trim() !== e.name && act('Rename', post('/files/rename', { cwd, from: at(e.name), to: at(to.trim()) })), 'plain-text', e.name),
      },
      {
        text: 'Move to Trash',
        style: 'destructive',
        onPress: () => act('Delete', del(`/files?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(at(e.name))}`)),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <>
      <Stack.Screen options={{ title }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon={tb('plus')}>
          <Stack.Toolbar.MenuAction icon={tb('doc')} onPress={newFile}>New file</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={tb('folder.badge.plus')} onPress={newFolder}>New folder</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={tb('photo.on.rectangle')} onPress={photos}>Upload photos</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={tb('doc.on.clipboard')} onPress={documents}>Upload files</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <FlatList
        contentContainerStyle={listStyle}
        style={{ flex: 1, backgroundColor: c.bg as any }}
        contentInsetAdjustmentBehavior="automatic"
        data={(data as FileEntry[] | null) ?? []}
        keyExtractor={(e) => e.name}
        refreshControl={<RefreshControl {...pull} />}
        ListHeaderComponent={error ? <Note error>{error}</Note> : undefined}
        ListEmptyComponent={data ? <Note>Empty folder. Use + to add a file or upload one.</Note> : undefined}
        renderItem={({ item: e }) => (
          <Row
            icon={<Icon name={e.dir ? 'folder' : IMAGE.test(e.name) ? 'photo' : 'doc'} size={20} color={e.dir ? c.blue : c.dim} />}
            title={e.name}
            right={e.dir ? <Icon name="chevron.right" size={13} color={c.faint} /> : <Text style={{ color: c.faint, fontSize: 12 }}>{size(e.size)}</Text>}
            onPress={() => router.push({ pathname: '/files', params: { cwd, path: at(e.name) } })}
            onLongPress={() => menu(e)}
          />
        )}
      />
    </>
  );
}

const color = (k: Kind) => (k === 'comment' ? c.faint : k === 'string' ? c.green : k === 'keyword' ? c.accent : k === 'number' ? c.blue : c.text);

function FileView({ cwd, path, title, file }: { cwd: string; path: string; title: string; file: FileContent }) {
  useHex();
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
      <Stack.Toolbar placement="right">
        {md && <Stack.Toolbar.Button icon={tb(source ? 'doc.richtext' : 'doc.plaintext')} onPress={() => setSource(!source)} />}
        {!!file.hash && <Stack.Toolbar.Button icon={tb('square.and.pencil')} onPress={() => router.push({ pathname: '/edit', params: { cwd, path } })} />}
      </Stack.Toolbar>
      <ScrollView style={{ flex: 1, backgroundColor: c.bg as any }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={md && !source ? { padding: 16 } : undefined}>
        {IMAGE.test(path) ? (
          pic ? <Image source={{ uri: pic }} style={{ width: '100%', aspectRatio: 1 }} contentFit="contain" /> : <Note error={!!picError}>{picError || 'Loading the picture…'}</Note>
        ) : file.binary ? (
          <Note>Binary file; not shown.</Note>
        ) : md && !source ? (
          <Markdown text={file.text} />
        ) : (
          <ScrollView horizontal contentContainerStyle={{ padding: 12 }}>
            <Text selectable style={{ color: c.text, fontFamily: mono, fontSize: 12, lineHeight: 17 }}>
              {spans ? spans.map((s, i) => <Text key={i} style={{ color: color(s.kind), fontStyle: s.kind === 'comment' ? 'italic' : 'normal' }}>{s.text}</Text>) : file.text}
            </Text>
          </ScrollView>
        )}
        {!!file.truncated && <Note>Showing the first 512 KB.</Note>}
      </ScrollView>
    </>
  );
}
